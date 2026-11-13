-- Calendar / agenda visuals: cor por procedimento + preferência do user
-- pra decidir destaque do card (status vs procedure).
-- UserPreferences.calendarColorMode é jsonb — sem migration (já flexível).

ALTER TABLE "procedures" ADD COLUMN "color" varchar(7);
