// =====================================================================
// GTP (General Technical Particulars) field schema.
// This is the single source of truth for:
//   1. The structured GTP form shown when creating/editing an Order
//   2. Which fields appear on each department's auto-generated work order
//      (via the `stages` tag on each field)
// Stored per-order as JSON in orders.gtp_json, keyed by field `key`.
// =====================================================================

const GTP_GROUPS = [
  {
    group: 'General',
    fields: [
      { key: 'rated_power', label: 'Rated Power', unit: 'kVA/MVA', type: 'text', stages: ['M1'] },
      { key: 'frequency', label: 'Frequency', unit: 'Hz', type: 'text', stages: ['M1'] },
      { key: 'phases', label: 'No. of Phases', type: 'text', stages: ['M1'] },
      { key: 'standard', label: 'Applicable Standard', unit: 'e.g. IS 2026 / IEC 60076', type: 'text', stages: ['M1'] },
      { key: 'cooling_type', label: 'Type of Cooling', unit: 'ONAN / ONAF / OFAF / ODAF', type: 'text', stages: ['M1', 'M6'] },
      { key: 'installation', label: 'Installation', unit: 'Indoor / Outdoor', type: 'text', stages: ['M1'] },
      { key: 'vector_group', label: 'Vector Group', type: 'text', stages: ['M1', 'M4', 'M5'] },
    ]
  },
  {
    group: 'Voltage & Ratios',
    fields: [
      { key: 'hv_voltage', label: 'HV Voltage', unit: 'kV', type: 'text', stages: ['M1', 'M4'] },
      { key: 'lv_voltage', label: 'LV Voltage', unit: 'kV', type: 'text', stages: ['M1', 'M4'] },
      { key: 'tertiary_voltage', label: 'Tertiary Voltage (if any)', unit: 'kV', type: 'text', stages: ['M1', 'M4'] },
      { key: 'voltage_variation', label: 'Voltage Variation Range', unit: '%', type: 'text', stages: ['M1', 'M4'] },
    ]
  },
  {
    group: 'Losses & Impedance',
    fields: [
      { key: 'no_load_loss_kw', label: 'No-Load Loss', unit: 'kW', type: 'text', stages: ['M1', 'M3', 'M10'] },
      { key: 'load_loss_kw', label: 'Load Loss', unit: 'kW', type: 'text', stages: ['M1', 'M4', 'M10'] },
      { key: 'impedance_pct', label: 'Impedance', unit: '%', type: 'text', stages: ['M1', 'M4', 'M10'] },
      { key: 'temp_rise_oil', label: 'Temperature Rise - Oil', unit: '°C', type: 'text', stages: ['M1', 'M8', 'M10'] },
      { key: 'temp_rise_winding', label: 'Temperature Rise - Winding', unit: '°C', type: 'text', stages: ['M1', 'M8', 'M10'] },
    ]
  },
  {
    group: 'Core',
    fields: [
      { key: 'core_material', label: 'Core Material / Grade', unit: 'e.g. CRGO M4', type: 'text', stages: ['M1', 'M3'] },
      { key: 'core_type', label: 'Core Type', unit: 'Core / Shell', type: 'text', stages: ['M1', 'M3'] },
      { key: 'flux_density', label: 'Flux Density', unit: 'Tesla', type: 'text', stages: ['M1', 'M3'] },
      { key: 'core_weight_kg', label: 'Core Weight', unit: 'kg', type: 'text', stages: ['M1', 'M3'] },
    ]
  },
  {
    group: 'Windings',
    fields: [
      { key: 'hv_winding_material', label: 'HV Winding Material', unit: 'Cu / Al', type: 'text', stages: ['M1', 'M4'] },
      { key: 'lv_winding_material', label: 'LV Winding Material', unit: 'Cu / Al', type: 'text', stages: ['M1', 'M4'] },
      { key: 'winding_type', label: 'Winding Type', unit: 'Disc / Helical / Layer', type: 'text', stages: ['M1', 'M4'] },
      { key: 'current_density', label: 'Current Density', unit: 'A/mm²', type: 'text', stages: ['M1', 'M4'] },
    ]
  },
  {
    group: 'Tap Changer',
    fields: [
      { key: 'tap_changer_type', label: 'Tap Changer Type', unit: 'OLTC / OCTC', type: 'text', stages: ['M1', 'M4', 'M5'] },
      { key: 'tap_range', label: 'Tap Range', unit: '%', type: 'text', stages: ['M1', 'M4', 'M5'] },
      { key: 'tap_steps', label: 'Number of Tap Steps', type: 'text', stages: ['M1', 'M4', 'M5'] },
    ]
  },
  {
    group: 'Insulation',
    fields: [
      { key: 'bil_hv', label: 'BIL - HV', unit: 'kV', type: 'text', stages: ['M1', 'M5', 'M10'] },
      { key: 'bil_lv', label: 'BIL - LV', unit: 'kV', type: 'text', stages: ['M1', 'M5', 'M10'] },
      { key: 'insulation_class', label: 'Insulation Class', type: 'text', stages: ['M1', 'M5', 'M8'] },
    ]
  },
  {
    group: 'Tank & Oil',
    fields: [
      { key: 'tank_type', label: 'Tank Type', unit: 'e.g. Corrugated / Plain with Radiators', type: 'text', stages: ['M1', 'M6'] },
      { key: 'oil_type', label: 'Oil Type', unit: 'e.g. Mineral / Synthetic Ester', type: 'text', stages: ['M1', 'M9'] },
      { key: 'oil_quantity_l', label: 'Total Oil Quantity', unit: 'Litres', type: 'text', stages: ['M1', 'M9'] },
      { key: 'untanked_weight_kg', label: 'Untanked Weight', unit: 'kg', type: 'text', stages: ['M1', 'M6'] },
      { key: 'total_weight_kg', label: 'Total Weight (Tanked)', unit: 'kg', type: 'text', stages: ['M1', 'M6'] },
    ]
  },
  {
    group: 'Bushings & Accessories',
    fields: [
      { key: 'hv_bushing', label: 'HV Bushing Type & Rating', type: 'text', stages: ['M1', 'M5'] },
      { key: 'lv_bushing', label: 'LV Bushing Type & Rating', type: 'text', stages: ['M1', 'M5'] },
      { key: 'paint_shade', label: 'Paint Shade', unit: 'e.g. RAL 7032', type: 'text', stages: ['M1', 'M7'] },
      { key: 'fittings', label: 'Standard Fittings / Accessories', type: 'textarea', stages: ['M1', 'M6'] },
    ]
  },
];

// Flat lookup: key -> field definition
const GTP_FIELD_MAP = {};
GTP_GROUPS.forEach(g => g.fields.forEach(f => { GTP_FIELD_MAP[f.key] = f; }));

// Returns [{key,label,unit,value}] of fields relevant to a given stage code,
// pulling actual values from a saved gtp_json object.
function fieldsForStage(stageCode, gtpData) {
  const data = gtpData || {};
  const result = [];
  GTP_GROUPS.forEach(g => {
    g.fields.forEach(f => {
      if (f.stages.includes(stageCode)) {
        result.push({ key: f.key, label: f.label, unit: f.unit || '', group: g.group, value: data[f.key] || '' });
      }
    });
  });
  return result;
}

module.exports = { GTP_GROUPS, GTP_FIELD_MAP, fieldsForStage };
