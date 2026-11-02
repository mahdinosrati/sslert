-- One-time transition: LDAP authorization is now managed in the panel.
UPDATE users SET role='user',can_create=0,can_edit=0,can_test=0,ldap_checked_at=NULL WHERE auth_source='ldap';
DELETE FROM api_tokens WHERE user_id IN (SELECT id FROM users WHERE auth_source='ldap');
-- Require fresh eight-hour sessions for all users; never reset credentials.
DELETE FROM sessions;
