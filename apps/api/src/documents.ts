import {
  BadRequestException,
  CallHandler,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { finalize } from 'rxjs';
import { z } from 'zod';
import type { Response } from 'express';
import { Cache, Database } from './database';
import { loadConfig } from './config';
import { AccessGuard, AuthRequest, Roles } from './security';
import { parse } from './validation';
import { DOCUMENT_KINDS, DocumentKind, MAX_DOCUMENT_BYTES, requiredKinds } from './document-policy';
import { profileSelect } from './drivers';

const documentSelect = `id,driver_id AS "driverId",kind,content_type AS "contentType",byte_size AS "byteSize",created_at AS "createdAt"`;
const uploadBody = z
  .object({ kind: z.enum(DOCUMENT_KINDS), expectedUpdatedAt: z.iso.datetime({ offset: true }) })
  .strict();
const INCREMENT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
export async function normalizeDocument(
  file: Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'size'>,
) {
  if (!file.size || file.size > MAX_DOCUMENT_BYTES || file.buffer.byteLength > MAX_DOCUMENT_BYTES)
    throw new BadRequestException('Choose a JPEG/PNG image up to 5 MiB');
  const png = file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255;
  if (!((png && file.mimetype === 'image/png') || (jpeg && file.mimetype === 'image/jpeg')))
    throw new BadRequestException('File content must match JPEG or PNG');
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 20_000_000,
      animated: false,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 32 ||
      metadata.height < 32 ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error('Unsupported dimensions');
    // Decode and re-encode; do not retain source EXIF, GPS or filenames.
    const buffer = await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90 })
      .toBuffer();
    if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error('Processed image too large');
    return buffer;
  } catch {
    throw new BadRequestException('Image is invalid, animated, too large or too small to inspect');
  }
}

@Injectable()
export class PrivateDocumentStore {
  readonly root = path.resolve(loadConfig().PRIVATE_DOCUMENTS_DIR);
  private filename(key: string) {
    parse(z.uuid(), key);
    return path.join(this.root, `${key}.jpg`);
  }
  async write(key: string, buffer: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      await writeFile(this.filename(key), buffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        await unlink(this.filename(key)).catch(() => {});
      throw error;
    }
  }
  read(key: string) {
    return readFile(this.filename(key));
  }
  async remove(key: string) {
    await unlink(this.filename(key)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

@Injectable()
export class UploadCapacityInterceptor implements NestInterceptor {
  private active = 0;
  intercept(_context: ExecutionContext, next: CallHandler) {
    if (this.active >= 2) throw new HttpException('Upload is busy. Try again later.', 429);
    this.active++;
    try {
      return next.handle().pipe(
        finalize(() => {
          this.active--;
        }),
      );
    } catch (error) {
      this.active--;
      throw error;
    }
  }
}
@Injectable()
export class DocumentRateGuard implements CanActivate {
  constructor(@Inject(Cache) private readonly cache: Cache) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const upload = request.method === 'POST';
    const count = Number(
      await this.cache.redis.eval(
        INCREMENT,
        1,
        `documents:${upload ? 'upload' : 'read'}:${request.account.id}`,
        String(upload ? 3600 : 60),
      ),
    );
    if (count > (upload ? 20 : 60))
      throw new HttpException('Document request limit reached. Try again later.', 429);
    return true;
  }
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(PrivateDocumentStore) private readonly store: PrivateDocumentStore,
  ) {}
  async list(driverId: string, reviewerId?: string) {
    return this.database.transaction(async (client) => {
      // Upload/review also lock this row; profile revision and document set form a consistent snapshot.
      const profile = (
        await client.query(
          `SELECT ${profileSelect} FROM driver_profiles WHERE user_id=$1 FOR SHARE`,
          [driverId],
        )
      ).rows[0];
      if (!profile) throw new NotFoundException('Driver profile not found');
      const documents = await client.query(
        `SELECT ${documentSelect} FROM driver_documents WHERE driver_id=$1 AND superseded_at IS NULL ORDER BY kind`,
        [driverId],
      );
      const viewed = reviewerId
        ? await client.query<{ id: string }>(
            `SELECT d.id FROM driver_documents d WHERE d.driver_id=$1 AND d.superseded_at IS NULL
        AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.actor_id=$2 AND a.entity_id=$1 AND a.action='driver.document.viewed' AND a.metadata->>'documentId'=d.id::text AND a.metadata->>'profileUpdatedAt'=$3)`,
            [driverId, reviewerId, new Date(profile.updatedAt).toISOString()],
          )
        : null;
      return {
        items: documents.rows,
        profile,
        requiredKinds: requiredKinds(loadConfig().DRIVER_REQUIRED_DOCUMENTS),
        viewedIds: viewed?.rows.map((row) => row.id) ?? [],
      };
    });
  }
  async upload(request: AuthRequest, input: z.infer<typeof uploadBody>, file: Express.Multer.File) {
    const buffer = await normalizeDocument(file);
    const key = randomUUID();
    const hash = createHash('sha256').update(buffer).digest('hex');
    let written = false;
    try {
      return await this.database.transaction(async (client) => {
        const profile = (
          await client.query('SELECT status FROM driver_profiles WHERE user_id=$1 FOR UPDATE', [
            request.account.id,
          ])
        ).rows[0];
        if (!profile)
          throw new ConflictException('Submit a vehicle profile before uploading documents');
        if (profile.status === 'approved')
          throw new ConflictException('Approved documents cannot be changed by the driver');
        const updated = (
          await client.query(
            `UPDATE driver_profiles SET status='pending',rejection_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,
          updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
          WHERE user_id=$1 AND updated_at=$2::timestamptz RETURNING ${profileSelect}`,
            [request.account.id, input.expectedUpdatedAt],
          )
        ).rows[0];
        if (!updated) throw new ConflictException('Profile changed. Reload before uploading.');
        try {
          await this.store.write(key, buffer);
          written = true;
        } catch {
          throw new ServiceUnavailableException('Private document storage unavailable');
        }
        await client.query(
          'UPDATE driver_documents SET superseded_at=now() WHERE driver_id=$1 AND kind=$2 AND superseded_at IS NULL',
          [request.account.id, input.kind],
        );
        const document = (
          await client.query(
            `INSERT INTO driver_documents(driver_id,kind,storage_key,content_type,byte_size,sha256)
          VALUES($1,$2,$3,'image/jpeg',$4,$5) RETURNING ${documentSelect}`,
            [request.account.id, input.kind, key, buffer.length, hash],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
          VALUES($1,'driver.document.uploaded','driver_profile',$1,$2)`,
          [request.account.id, JSON.stringify({ documentId: document.id, kind: input.kind })],
        );
        return { document, profile: updated };
      });
    } catch (error) {
      if (written) {
        // A failed COMMIT can be ambiguous. Never delete a possibly committed document.
        try {
          const referenced = await this.database.pool.query(
            'SELECT 1 FROM driver_documents WHERE storage_key=$1',
            [key],
          );
          if (!referenced.rowCount) await this.store.remove(key);
        } catch {
          console.error(JSON.stringify({ event: 'documents.orphan.reconciliation_needed' }));
        }
      }
      throw error;
    }
  }
  async content(id: string, request: AuthRequest) {
    const reviewer = ['admin', 'dispatcher'].includes(request.account.role);
    const owner = request.account.role === 'driver';
    const document = (
      await this.database.pool.query<{
        storage_key: string;
        driver_id: string;
        kind: DocumentKind;
        byte_size: number;
        sha256: string;
        profile_updated_at: Date;
      }>(
        `SELECT d.storage_key,d.driver_id,d.kind,d.byte_size,d.sha256,p.updated_at AS profile_updated_at FROM driver_documents d JOIN driver_profiles p ON p.user_id=d.driver_id
       WHERE d.id=$1 AND d.superseded_at IS NULL AND (($3::boolean AND d.driver_id=$2) OR $4::boolean)`,
        [id, request.account.id, owner, reviewer],
      )
    ).rows[0];
    if (!document) throw new NotFoundException();
    let buffer: Buffer;
    try {
      buffer = await this.store.read(document.storage_key);
    } catch {
      throw new ServiceUnavailableException('Document unavailable. Contact support.');
    }
    if (
      buffer.length !== document.byte_size ||
      createHash('sha256').update(buffer).digest('hex') !== document.sha256
    )
      throw new ServiceUnavailableException('Document integrity check failed');
    await this.database.pool.query(
      `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
      VALUES($1,'driver.document.viewed','driver_profile',$2,$3)`,
      [
        request.account.id,
        document.driver_id,
        JSON.stringify({
          documentId: id,
          kind: document.kind,
          profileUpdatedAt: new Date(document.profile_updated_at).toISOString(),
        }),
      ],
    );
    return { buffer, kind: document.kind };
  }
}

@Controller('drivers/me/documents')
@UseGuards(AccessGuard)
@Roles('driver')
export class DriverDocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}
  @Get() list(@Req() request: AuthRequest) {
    return this.documents.list(request.account.id);
  }
  @Post()
  @UseGuards(DocumentRateGuard)
  @UseInterceptors(
    UploadCapacityInterceptor,
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 2, parts: 3, fieldSize: 200 },
      fileFilter: (_request, file, done) => {
        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
          done(new BadRequestException('Only JPEG and PNG images are supported'), false);
          return;
        }
        done(null, true);
      },
    }),
  )
  upload(
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AuthRequest,
  ) {
    const input = parse(uploadBody, body);
    if (!file) throw new BadRequestException('Image file is required');
    return this.documents.upload(request, input, file);
  }
}
@Controller('admin/drivers')
@UseGuards(AccessGuard)
@Roles('admin', 'dispatcher')
export class AdminDocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}
  @Get(':id/documents') list(@Param('id') id: string, @Req() request: AuthRequest) {
    parse(z.uuid(), id);
    return this.documents.list(id, request.account.id);
  }
}
@Controller('driver-documents')
@UseGuards(AccessGuard)
export class DocumentContentController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}
  @Get(':id/content')
  @UseGuards(DocumentRateGuard)
  async content(
    @Param('id') id: string,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(z.uuid(), id);
    const document = await this.documents.content(id, request);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    return new StreamableFile(document.buffer, {
      type: 'image/jpeg',
      disposition: `attachment; filename="${document.kind}.jpg"`,
      length: document.buffer.length,
    });
  }
}
