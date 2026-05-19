-- Fix maintenance_history_view: cast status to text on both sides of UNION ALL
-- so that inspection overall_result values (e.g. 'partial') are not coerced
-- into the os_status enum and cause a runtime error.

DROP VIEW IF EXISTS maintenance_history_view;
CREATE VIEW maintenance_history_view AS
SELECT
  wo.id,
  wo.tenant_id,
  wo.machinery_id,
  m.name                    AS machinery_name,
  m.model                   AS machinery_model,
  m.license_plate           AS machinery_plate,
  wo.farm_id,
  f.name                    AS farm_name,
  wo.os_number,
  wo.title,
  wo.maintenance_type,
  wo.priority,
  wo.status::text           AS status,
  wo.opened_at,
  wo.completed_at,
  EXTRACT(DAY FROM wo.completed_at - wo.opened_at::TIMESTAMPTZ)::INTEGER
                            AS days_to_complete,
  wo.assigned_to,
  wo.parts_cost,
  wo.labor_cost,
  wo.other_cost,
  wo.total_cost,
  wo.labor_hours,
  wo.meter_reading_start,
  wo.meter_reading_end,
  wo.meter_unit,
  wo.problem_desc,
  wo.solution_desc,
  p.name                    AS supplier_name,
  'work_order'              AS record_type
FROM work_orders wo
LEFT JOIN machinery m ON m.id = wo.machinery_id
LEFT JOIN farms     f ON f.id = wo.farm_id
LEFT JOIN partners  p ON p.id = wo.supplier_id

UNION ALL

SELECT
  ic.id,
  ic.tenant_id,
  ic.machinery_id,
  m.name,
  m.model,
  m.license_plate,
  ic.farm_id,
  f.name,
  NULL,                     -- os_number
  ic.title,
  'inspection',
  'low',
  ic.overall_result::text,  -- cast to text to avoid os_status enum coercion
  ic.inspected_at,
  NULL,                     -- completed_at
  NULL,                     -- days_to_complete
  ic.inspector,
  0, 0, 0, 0,              -- costs
  NULL,                     -- labor_hours
  ic.meter_reading, NULL, ic.meter_unit,
  NULL, NULL,               -- problem/solution
  NULL,
  'inspection'
FROM inspection_checklists ic
LEFT JOIN machinery m ON m.id = ic.machinery_id
LEFT JOIN farms     f ON f.id = ic.farm_id

ORDER BY opened_at DESC NULLS LAST;
