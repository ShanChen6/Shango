-- WEB-009: quotes, orders, sequential dispatch offers and order history.
-- Money is integer VND. Coordinates are geography(Point,4326) built as (lng, lat).
CREATE TABLE order_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('motorcycle','car')),
  stops jsonb NOT NULL,
  distance_m integer NOT NULL CHECK (distance_m > 0),
  duration_s integer NOT NULL CHECK (duration_s >= 0),
  price_vnd bigint NOT NULL CHECK (price_vnd > 0),
  tariff jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_quotes_customer_idx ON order_quotes(customer_id, created_at DESC);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL UNIQUE REFERENCES order_quotes(id),
  customer_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES driver_profiles(user_id),
  status text NOT NULL CHECK (status IN
    ('SEARCHING','ASSIGNED','AT_PICKUP','PICKED_UP','IN_TRANSIT','DELIVERED','CANCELLED','EXPIRED')),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('motorcycle','car')),
  pickup_position geography(Point,4326) NOT NULL,
  dropoff_position geography(Point,4326) NOT NULL,
  stops jsonb NOT NULL,
  distance_m integer NOT NULL,
  duration_s integer NOT NULL,
  price_vnd bigint NOT NULL CHECK (price_vnd > 0),
  tariff jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  search_deadline timestamptz NOT NULL,
  cancel_reason text,
  cancelled_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (CASE
    WHEN status IN ('SEARCHING','EXPIRED') THEN driver_id IS NULL
    WHEN status = 'CANCELLED' THEN true
    ELSE driver_id IS NOT NULL END)
);
CREATE INDEX orders_customer_idx ON orders(customer_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders(status, created_at DESC);
CREATE INDEX orders_searching_idx ON orders(created_at) WHERE status = 'SEARCHING';
-- A driver holds at most one active order; enforced by the database, not only the UI.
CREATE UNIQUE INDEX orders_driver_active_uidx ON orders(driver_id)
  WHERE status IN ('ASSIGNED','AT_PICKUP','PICKED_UP','IN_TRANSIT');

CREATE TABLE order_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','withdrawn')),
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (order_id, driver_id)
);
CREATE UNIQUE INDEX order_offers_pending_order_uidx ON order_offers(order_id) WHERE status = 'pending';
CREATE UNIQUE INDEX order_offers_pending_driver_uidx ON order_offers(driver_id) WHERE status = 'pending';
CREATE INDEX order_offers_expiry_idx ON order_offers(expires_at) WHERE status = 'pending';

CREATE TABLE order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  version integer NOT NULL,
  status text NOT NULL,
  actor_id uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, version)
);

ALTER TABLE driver_locations
  ADD COLUMN accuracy_m integer CHECK (accuracy_m >= 0),
  ADD COLUMN recorded_at timestamptz;
CREATE INDEX driver_locations_fresh_idx ON driver_locations(last_seen_at) WHERE is_available;
