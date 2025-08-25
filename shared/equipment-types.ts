// Comprehensive equipment types matching DAT.com Load Board
// This ensures consistency across the entire platform and matches DAT's equipment categories

export const EQUIPMENT_TYPES = [
  // Van Equipment (matches DAT Van category)
  { value: 'dry_van', label: 'Van (Dry Van)', category: 'van', description: 'Standard dry van trailer', datCode: 'V' },
  { value: 'van_air_ride', label: 'Van Air Ride', category: 'van', description: 'Van with air suspension', datCode: 'VA' },
  { value: 'van_conestoga', label: 'Van Conestoga', category: 'van', description: 'Van with rolling tarp system', datCode: 'VS' },
  { value: 'van_double', label: 'Van Double', category: 'van', description: 'Van designed to carry two loads', datCode: 'V2' },
  { value: 'van_team', label: 'Van w/ Team', category: 'van', description: 'Van operated by team drivers', datCode: 'VM' },
  { value: 'van_blanket_wrap', label: 'Van w/ Blanket Wrap', category: 'van', description: 'Van equipped with blankets for delicate items', datCode: 'VW' },
  { value: 'insulated_van', label: 'Insulated Van', category: 'van', description: 'Van with insulation for temperature-sensitive goods', datCode: 'IR' },

  // Box Truck & Straight Truck Equipment (matches DAT Box Truck category)
  { value: 'straight_box_truck', label: 'Straight Box Truck', category: 'box_truck', description: 'Single-unit truck with cargo area', datCode: 'SB' },
  { value: 'sprinter_van', label: 'Sprinter/Cargo Van', category: 'box_truck', description: 'For smaller loads (15 feet and 10,000 lbs or less)', datCode: 'SPRINTER' },
  { value: 'moving_van', label: 'Moving Van', category: 'box_truck', description: 'Van designed for household/commercial moves', datCode: 'MV' },
  { value: 'box_truck_lift_gate', label: 'Box Truck w/ Lift Gate', category: 'box_truck', description: 'Box truck with hydraulic lift gate', datCode: 'SB_LG' },
  { value: 'cargo_van', label: 'Cargo Van', category: 'box_truck', description: 'Standard cargo van for small deliveries', datCode: 'CV' },

  // Refrigerated (Reefer) Equipment  
  { value: 'refrigerated', label: 'Reefer (Refrigerated)', category: 'reefer', description: 'Standard refrigerated trailer', datCode: 'R' },
  { value: 'reefer_air_ride', label: 'Reefer Air-Ride', category: 'reefer', description: 'Reefer with air suspension', datCode: 'RA' },
  { value: 'reefer_double', label: 'Reefer Double', category: 'reefer', description: 'Reefer for double loads', datCode: 'R2' },
  { value: 'reefer_hazmat', label: 'Reefer Hazmat', category: 'reefer', description: 'Reefer for hazardous materials', datCode: 'RZ' },
  { value: 'reefer_intermodal', label: 'Reefer Intermodal', category: 'reefer', description: 'Reefer suitable for multiple transport modes', datCode: 'RN' },
  { value: 'reefer_team', label: 'Reefer w/ Team', category: 'reefer', description: 'Reefer operated by team drivers', datCode: 'RM' },
  { value: 'reefer_pallet_exchange', label: 'Reefer w/ Pallet Exchange', category: 'reefer', description: 'Reefer equipped for pallet exchange', datCode: 'RP' },

  // Flatbed Equipment
  { value: 'flatbed', label: 'Flatbed', category: 'flatbed', description: 'Standard open-deck trailer', datCode: 'F' },
  { value: 'flatbed_air_ride', label: 'Flatbed Air-Ride', category: 'flatbed', description: 'Flatbed with air suspension', datCode: 'FA' },
  { value: 'flatbed_conestoga', label: 'Flatbed Conestoga', category: 'flatbed', description: 'Flatbed with rolling tarp system', datCode: 'FN' },
  { value: 'flatbed_double', label: 'Flatbed Double', category: 'flatbed', description: 'Flatbed for double loads', datCode: 'F2' },
  { value: 'flatbed_hazmat', label: 'Flatbed Hazmat', category: 'flatbed', description: 'Flatbed for hazardous materials', datCode: 'FZ' },
  { value: 'flatbed_hotshot', label: 'Flatbed Hotshot', category: 'flatbed', description: 'Flatbed for expedited delivery', datCode: 'FH' },
  { value: 'flatbed_maxi', label: 'Flatbed Maxi', category: 'flatbed', description: 'Extended flatbed trailer', datCode: 'MX' },
  { value: 'flatbed_step_deck', label: 'Flatbed or Step Deck', category: 'flatbed', description: 'Combined flatbed/step deck capability', datCode: 'FD' },
  { value: 'flatbed_sides', label: 'Flatbed w/ Sides', category: 'flatbed', description: 'Flatbed with side rails', datCode: 'FS' },
  { value: 'flatbed_tarps', label: 'Flatbed w/ Tarps', category: 'flatbed', description: 'Flatbed equipped with tarps', datCode: 'FT' },
  { value: 'flatbed_team', label: 'Flatbed w/ Team', category: 'flatbed', description: 'Flatbed operated by team drivers', datCode: 'FM' },
  { value: 'flatbed_over_dimension', label: 'Flatbed Over Dimension', category: 'flatbed', description: 'Flatbed for oversized loads', datCode: 'FO' },
  { value: 'flatbed_chains', label: 'Flatbed w/ Chains', category: 'flatbed', description: 'Flatbed equipped with load chains', datCode: 'FC' },

  // Specialized Trailers
  { value: 'step_deck', label: 'Step Deck (Drop Deck)', category: 'specialized', description: 'Trailer with lower deck for taller loads', datCode: 'SD' },
  { value: 'stepdeck_conestoga', label: 'Stepdeck Conestoga', category: 'specialized', description: 'Step deck with rolling tarp system', datCode: 'SN' },
  { value: 'double_drop', label: 'Double Drop', category: 'specialized', description: 'Trailer with lower middle deck for tall freight', datCode: 'DD' },
  { value: 'lowboy', label: 'Lowboy', category: 'specialized', description: 'Trailer with low deck height for tall equipment', datCode: 'LB' },
  { value: 'lowboy_over_dimension', label: 'Lowboy Over Dimension', category: 'specialized', description: 'Lowboy for oversized loads', datCode: 'LO' },
  { value: 'removable_gooseneck', label: 'Removable Gooseneck (RGN)', category: 'specialized', description: 'Trailer with detachable front for loading', datCode: 'RG' },
  { value: 'drop_deck_landoll', label: 'Drop Deck Landoll', category: 'specialized', description: 'Specialized lowboy trailer', datCode: 'LA' },
  { value: 'stretch_trailer', label: 'Stretch Trailer', category: 'specialized', description: 'Extendable trailer for long loads', datCode: 'ST' },

  // Tanker Equipment
  { value: 'tanker_aluminum', label: 'Tanker Aluminum', category: 'tanker', description: 'Aluminum tanker for liquids', datCode: 'TA' },
  { value: 'tanker_steel', label: 'Tanker Steel', category: 'tanker', description: 'Steel tanker for liquids', datCode: 'TS' },
  { value: 'tanker_intermodal', label: 'Tanker Intermodal', category: 'tanker', description: 'Tanker suitable for multiple transport modes', datCode: 'TN' },
  { value: 'pneumatic', label: 'Pneumatic', category: 'tanker', description: 'Trailer using air pressure to unload dry bulk goods', datCode: 'NU' },
  { value: 'hopper_bottom', label: 'Hopper Bottom', category: 'tanker', description: 'Trailer with sloped floor for unloading bulk commodities', datCode: 'HB' },

  // Container & Intermodal
  { value: 'container', label: 'Container Chassis', category: 'intermodal', description: 'For shipping containers', datCode: 'C' },
  { value: 'container_insulated', label: 'Container Insulated', category: 'intermodal', description: 'Insulated container for temperature-sensitive goods', datCode: 'CI' },
  { value: 'container_refrigerated', label: 'Container Refrigerated', category: 'intermodal', description: 'Refrigerated container for perishables', datCode: 'CR' },

  // Specialty Equipment
  { value: 'car_carrier', label: 'Auto Carrier (Car Carrier)', category: 'specialty', description: 'Designed for transporting vehicles', datCode: 'AC' },
  { value: 'power_only', label: 'Power Only', category: 'specialty', description: 'Tractor unit without trailer', datCode: 'PO' },
  { value: 'truck_trailer', label: 'Truck and Trailer', category: 'specialty', description: 'Combination of truck and trailer', datCode: 'TT' },
  { value: 'conveyor', label: 'Conveyor', category: 'specialty', description: 'Equipped with conveyor belt for easy loading/unloading', datCode: 'CV' },
  { value: 'b_train', label: 'B-Train', category: 'specialty', description: 'Combination of two trailers connected by fifth wheel', datCode: 'BT' },
  { value: 'conestoga', label: 'Conestoga', category: 'specialty', description: 'Flatbed with rolling tarp system', datCode: 'CN' },
  { value: 'dump_truck', label: 'Dump Trailer', category: 'specialty', description: 'For construction and bulk materials', datCode: 'DT' }
] as const;

export type EquipmentTypeValue = typeof EQUIPMENT_TYPES[number]['value'];

// Equipment categories for filtering and organization
export const EQUIPMENT_CATEGORIES = [
  { value: 'van', label: 'Van Trailers' },
  { value: 'box_truck', label: 'Box Trucks & Cargo Vans' },
  { value: 'reefer', label: 'Refrigerated (Reefer)' },
  { value: 'flatbed', label: 'Flatbed Trailers' },
  { value: 'specialized', label: 'Specialized Trailers' },
  { value: 'tanker', label: 'Tanker Equipment' },
  { value: 'intermodal', label: 'Container & Intermodal' },
  { value: 'specialty', label: 'Specialty Equipment' }
] as const;

// DAT equipment code mapping for integration
export const DAT_EQUIPMENT_MAPPING = {
  // Van codes
  'V': 'dry_van',
  'VAN': 'dry_van',
  'VA': 'van_air_ride',
  'VS': 'van_conestoga',
  'V2': 'van_double',
  'VM': 'van_team',
  'VW': 'van_blanket_wrap',
  'IR': 'insulated_van',

  // Box Truck codes
  'SB': 'straight_box_truck',
  'SPRINTER': 'sprinter_van',
  'MV': 'moving_van',
  'CV': 'cargo_van',
  'BOX': 'straight_box_truck',

  // Reefer codes
  'R': 'refrigerated',
  'REEFER': 'refrigerated',
  'RA': 'reefer_air_ride',
  'R2': 'reefer_double',
  'RZ': 'reefer_hazmat',
  'RN': 'reefer_intermodal',
  'RM': 'reefer_team',
  'RP': 'reefer_pallet_exchange',

  // Flatbed codes
  'F': 'flatbed',
  'FLATBED': 'flatbed',
  'FA': 'flatbed_air_ride',
  'FN': 'flatbed_conestoga',
  'F2': 'flatbed_double',
  'FZ': 'flatbed_hazmat',
  'FH': 'flatbed_hotshot',
  'MX': 'flatbed_maxi',
  'FD': 'flatbed_step_deck',
  'FS': 'flatbed_sides',
  'FT': 'flatbed_tarps',
  'FM': 'flatbed_team',
  'FO': 'flatbed_over_dimension',
  'FC': 'flatbed_chains',

  // Specialized codes
  'SD': 'step_deck',
  'SN': 'stepdeck_conestoga',
  'DD': 'double_drop',
  'LB': 'lowboy',
  'LO': 'lowboy_over_dimension',
  'RG': 'removable_gooseneck',
  'LA': 'drop_deck_landoll',
  'ST': 'stretch_trailer',

  // Tanker codes
  'TA': 'tanker_aluminum',
  'TS': 'tanker_steel',
  'TN': 'tanker_intermodal',
  'NU': 'pneumatic',
  'HB': 'hopper_bottom',

  // Container codes
  'C': 'container',
  'CI': 'container_insulated',
  'CR': 'container_refrigerated',

  // Specialty codes
  'AC': 'car_carrier',
  'PO': 'power_only',
  'TT': 'truck_trailer',
  'BT': 'b_train',
  'CN': 'conestoga',
  'DT': 'dump_truck'
} as const;

// Equipment compatibility for load matching
export const EQUIPMENT_COMPATIBILITY = {
  // Van family
  dry_van: ['dry_van', 'van_air_ride', 'sprinter_van', 'cargo_van'],
  van_air_ride: ['van_air_ride', 'dry_van'],
  van_conestoga: ['van_conestoga', 'dry_van'],
  van_double: ['van_double', 'dry_van'],
  van_team: ['van_team', 'dry_van'],
  van_blanket_wrap: ['van_blanket_wrap', 'dry_van'],
  insulated_van: ['insulated_van', 'dry_van'],

  // Box truck family
  straight_box_truck: ['straight_box_truck', 'cargo_van', 'sprinter_van', 'dry_van'],
  sprinter_van: ['sprinter_van', 'cargo_van'],
  moving_van: ['moving_van', 'straight_box_truck', 'cargo_van'],
  box_truck_lift_gate: ['box_truck_lift_gate', 'straight_box_truck'],
  cargo_van: ['cargo_van', 'sprinter_van'],

  // Reefer family (can handle dry loads too)
  refrigerated: ['refrigerated', 'reefer_air_ride', 'dry_van', 'cargo_van'],
  reefer_air_ride: ['reefer_air_ride', 'refrigerated', 'dry_van'],
  reefer_double: ['reefer_double', 'refrigerated'],
  reefer_hazmat: ['reefer_hazmat', 'refrigerated'],
  reefer_intermodal: ['reefer_intermodal', 'refrigerated'],
  reefer_team: ['reefer_team', 'refrigerated'],
  reefer_pallet_exchange: ['reefer_pallet_exchange', 'refrigerated'],

  // Flatbed family
  flatbed: ['flatbed', 'flatbed_air_ride', 'flatbed_hotshot'],
  flatbed_air_ride: ['flatbed_air_ride', 'flatbed'],
  flatbed_conestoga: ['flatbed_conestoga', 'flatbed'],
  flatbed_double: ['flatbed_double', 'flatbed'],
  flatbed_hazmat: ['flatbed_hazmat', 'flatbed'],
  flatbed_hotshot: ['flatbed_hotshot', 'flatbed'],
  flatbed_maxi: ['flatbed_maxi', 'flatbed'],
  flatbed_step_deck: ['flatbed_step_deck', 'step_deck', 'flatbed'],
  flatbed_sides: ['flatbed_sides', 'flatbed'],
  flatbed_tarps: ['flatbed_tarps', 'flatbed'],
  flatbed_team: ['flatbed_team', 'flatbed'],
  flatbed_over_dimension: ['flatbed_over_dimension', 'flatbed'],
  flatbed_chains: ['flatbed_chains', 'flatbed'],

  // Specialized trailers
  step_deck: ['step_deck', 'flatbed', 'flatbed_step_deck'],
  stepdeck_conestoga: ['stepdeck_conestoga', 'step_deck'],
  double_drop: ['double_drop', 'step_deck', 'lowboy'],
  lowboy: ['lowboy', 'double_drop', 'step_deck'],
  lowboy_over_dimension: ['lowboy_over_dimension', 'lowboy'],
  removable_gooseneck: ['removable_gooseneck', 'lowboy'],
  drop_deck_landoll: ['drop_deck_landoll', 'lowboy'],
  stretch_trailer: ['stretch_trailer', 'flatbed'],

  // Tanker equipment (exclusive)
  tanker_aluminum: ['tanker_aluminum'],
  tanker_steel: ['tanker_steel'],
  tanker_intermodal: ['tanker_intermodal'],
  pneumatic: ['pneumatic'],
  hopper_bottom: ['hopper_bottom'],

  // Container equipment
  container: ['container'],
  container_insulated: ['container_insulated', 'container'],
  container_refrigerated: ['container_refrigerated', 'container'],

  // Specialty equipment (mostly exclusive)
  car_carrier: ['car_carrier'],
  power_only: ['power_only'],
  truck_trailer: ['truck_trailer'],
  conveyor: ['conveyor'],
  b_train: ['b_train'],
  conestoga: ['conestoga', 'flatbed'],
  dump_truck: ['dump_truck']
} as const;

// Helper function to check if driver equipment can handle load equipment
export function canHandleEquipmentType(driverEquipment: string, loadEquipment: string): boolean {
  const compatibleTypes = EQUIPMENT_COMPATIBILITY[driverEquipment as keyof typeof EQUIPMENT_COMPATIBILITY];
  return compatibleTypes?.includes(loadEquipment as any) || driverEquipment === loadEquipment;
}

// Helper function to get equipment type info
export function getEquipmentTypeInfo(equipmentType: string) {
  return EQUIPMENT_TYPES.find(eq => eq.value === equipmentType);
}

// Helper function to get equipment types by category
export function getEquipmentTypesByCategory(category: string) {
  return EQUIPMENT_TYPES.filter(eq => eq.category === category);
}

// Helper function to map DAT equipment code to internal type
export function mapDATEquipmentType(datCode: string): string {
  return DAT_EQUIPMENT_MAPPING[datCode as keyof typeof DAT_EQUIPMENT_MAPPING] || 'dry_van';
}

// Helper function to get DAT code from internal equipment type
export function getDATCodeFromEquipmentType(equipmentType: string): string {
  const equipment = EQUIPMENT_TYPES.find(eq => eq.value === equipmentType);
  return equipment?.datCode || 'V';
}