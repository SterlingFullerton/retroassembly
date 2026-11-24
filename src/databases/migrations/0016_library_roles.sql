-- The server has one library, and a role says what each account may do in it. Admins stay admins; of the rest, those
-- who shared the admin's library, which they could only read, are players, and those with a library of their own,
-- which they could add to, are contributors. Their games are brought into the server's library when it next starts
UPDATE `users` SET `role` = CASE WHEN `role` = 'admin' THEN 'admin' WHEN `library_mode` = 1 THEN 'player' ELSE 'contributor' END;
