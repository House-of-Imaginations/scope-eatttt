CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_event (created_at) WHERE dispatched_at IS NULL;

CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_notify ON outbox_event;

CREATE TRIGGER outbox_notify
AFTER INSERT ON outbox_event
FOR EACH ROW EXECUTE FUNCTION notify_outbox();
