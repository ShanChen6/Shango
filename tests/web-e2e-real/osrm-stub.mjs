// Deterministic OSRM stand-in for CI contract E2E only (3.2 km, 10 min).
import { createServer } from 'node:http';
createServer((_request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      code: 'Ok',
      routes: [
        {
          distance: 3200,
          duration: 600,
          geometry: {
            type: 'LineString',
            coordinates: [
              [105.852, 21.028],
              [105.8355, 21.0293],
            ],
          },
        },
      ],
    }),
  );
}).listen(5999, '127.0.0.1');
