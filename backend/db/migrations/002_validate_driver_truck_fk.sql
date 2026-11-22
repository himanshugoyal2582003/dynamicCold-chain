-- All existing driver truck references were checked for orphans before this
-- migration. Validate the existing relationship without changing any rows.
ALTER TABLE users VALIDATE CONSTRAINT users_truck_id_fk;
