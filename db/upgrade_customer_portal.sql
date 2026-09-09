-- =====================================================================
-- Upgrade: Customer Portal (customers, customer_users, order/job linking,
-- customer-visible document flag)
-- Run this ONCE against an existing database. All statements are additive -
-- safe to run on a live database. If you are setting up a brand new
-- database, schema.sql already includes everything in this file.
-- =====================================================================

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_email VARCHAR(150) DEFAULT NULL,
  contact_phone VARCHAR(30) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders
  ADD COLUMN customer_id INT DEFAULT NULL COMMENT 'Optional link to customers - required for this order to appear in the Customer Portal' AFTER customer_name,
  ADD FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE jobs
  ADD COLUMN customer_id INT DEFAULT NULL COMMENT 'Copied from the order when created via a Lot; set directly for a standalone job - see customers table' AFTER customer_name,
  ADD FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE documents
  ADD COLUMN customer_visible TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Shown in the Customer Portal if this document''s job/order belongs to a linked customer' AFTER related_warranty_claim_id;

-- Backfill jobs.customer_id from their order, for units created before this
-- upgrade ran. Going forward, routes/orders.js copies it at lot-creation time.
UPDATE jobs j JOIN orders o ON j.order_id = o.id
SET j.customer_id = o.customer_id
WHERE o.customer_id IS NOT NULL AND j.customer_id IS NULL;
