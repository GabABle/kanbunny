-- Add due_date to checklist_items
alter table checklist_items add column if not exists due_date timestamptz default null;
