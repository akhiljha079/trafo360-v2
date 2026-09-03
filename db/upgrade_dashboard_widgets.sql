-- =====================================================================
-- Upgrade: Dashboard Widget Customization
-- Run this ONCE against an existing database that predates this change.
-- A fresh `npm run seed` on a new database already includes everything
-- via schema.sql - do not run this against a fresh install.
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS user_dashboard_widgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  widget_key VARCHAR(60) NOT NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  sequence_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_user_widget (user_id, widget_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
