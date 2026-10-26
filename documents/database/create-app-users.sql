-- Application logins for the chat_application schema. Run once as a MySQL admin:
--   mysql -u root -p < documents/database/create-app-users.local.sql
--
-- admin : everything on the schema. used by the default pool, by express-mysql-session (which
--         creates and maintains the `sessions` table itself) and by any future migration step
-- user  : day-to-day reads and writes, no ddl. pass dbConfig.userPool to executeQuery for it
--
-- the accounts are bound to 'localhost' because DB_HOST=localhost. if the server ever runs on
-- another machine, add matching accounts for that host.

-- remove the earlier three-login setup (safe to run even if they never existed)
DROP USER IF EXISTS 'chatapp_admin'@'localhost';
DROP USER IF EXISTS 'chatapp_operator'@'localhost';
DROP USER IF EXISTS 'chatapp_viewer'@'localhost';

CREATE USER 'chatapp_admin'@'localhost' IDENTIFIED BY 'Admin@123';
CREATE USER 'chatapp_user'@'localhost'  IDENTIFIED BY 'Chatuser@123';

GRANT ALL PRIVILEGES                 ON chat_application.* TO 'chatapp_admin'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_application.* TO 'chatapp_user'@'localhost';

FLUSH PRIVILEGES;

-- check: expect exactly chatapp_admin and chatapp_user
SELECT user, host FROM mysql.user WHERE user LIKE 'chatapp_%';
