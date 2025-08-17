// Comprehensive equipment types for drivers and loads
// This ensures consistency across the entire platform

export const EQUIPMENT_TYPES = [
  // Standard Trucking Equipment
  { value: 'dry_van', label: 'Dry Van', category: 'van', description: 'Standard enclosed trailer' },
  { value: 'refrigerated', label: 'Refrigerated (Reefer)', category: 'van', description: 'Temperature-controlled trailer' },
  { value: 'flatbed', label: 'Flatbed', category: 'flatbed', description: 'Open deck trailer' },
  { value: 'step_deck', label: 'Step Deck (Drop Deck)', category: 'flatbed', description: 'Lower deck height for tall cargo' },
  { value: 'lowboy', label: 'Lowboy', category: 'flatbed', description: 'Very low deck height for heavy equipment' },
  { value: 'removable_gooseneck', label: 'Removable Gooseneck (RGN)', category: 'flatbed', description: 'Detachable front for loading' },
  { value: 'conestoga', label: 'Conestoga', category: 'flatbed', description: 'Flatbed with retractable tarp system' },
  
  // Specialized Equipment
  { value: 'power_only', label: 'Power Only', category: 'specialized', description: 'Tractor only, customer provides trailer' },
  { value: 'container', label: 'Container Chassis', category: 'specialized', description: 'For shipping containers' },
  { value: 'car_carrier', label: 'Car Carrier (Auto Hauler)', category: 'specialized', description: 'Multi-level vehicle transport' },
  { value: 'tanker', label: 'Tanker', category: 'specialized', description: 'Liquid cargo transport' },
  { value: 'dump_truck', label: 'Dump Truck', category: 'specialized', description: 'Construction material hauling' },
  
  // Box Truck / Van Categories  
  { value: 'vans_standard', label: 'Standard Van', category: 'box_truck', description: 'Small delivery van' },
  { value: 'van_lift_gate', label: 'Van with Lift Gate', category: 'box_truck', description: 'Van with hydraulic lift' },
  { value: 'van_hotshot', label: 'Hotshot Van', category: 'box_truck', description: 'Expedited delivery van' },
  { value: 'straight_box_truck', label: 'Straight Box Truck', category: 'box_truck', description: 'Single unit truck with box' },
  { value: 'moving_van', label: 'Moving Van', category: 'box_truck', description: 'Household goods transport' },
  { value: 'flatbed_hotshot', label: 'Flatbed Hotshot', category: 'box_truck', description: 'Small flatbed for urgent delivery' }
] as const;

export type EquipmentTypeValue = typeof EQUIPMENT_TYPES[number]['value'];

// Equipment categories for filtering and organization
export const EQUIPMENT_CATEGORIES = [
  { value: 'van', label: 'Van Trailers' },
  { value: 'flatbed', label: 'Flatbed Trailers' },
  { value: 'specialized', label: 'Specialized Equipment' },
  { value: 'box_truck', label: 'Box Trucks & Vans' }
] as const;

// Equipment matching rules for load assignment
export const EQUIPMENT_COMPATIBILITY = {
  // Dry van can handle most standard loads
  dry_van: ['dry_van', 'vans_standard'],
  
  // Refrigerated can handle both reefer and dry loads
  refrigerated: ['refrigerated', 'dry_van', 'vans_standard'],
  
  // Flatbed family compatibility
  flatbed: ['flatbed', 'flatbed_hotshot'],
  step_deck: ['step_deck', 'flatbed', 'flatbed_hotshot'],
  lowboy: ['lowboy', 'step_deck', 'flatbed'],
  removable_gooseneck: ['removable_gooseneck', 'lowboy', 'step_deck'],
  conestoga: ['conestoga', 'flatbed'],
  
  // Box truck family
  straight_box_truck: ['straight_box_truck', 'vans_standard', 'dry_van'],
  moving_van: ['moving_van', 'straight_box_truck', 'vans_standard'],
  van_lift_gate: ['van_lift_gate', 'vans_standard'],
  van_hotshot: ['van_hotshot', 'vans_standard'],
  flatbed_hotshot: ['flatbed_hotshot', 'flatbed'],
  vans_standard: ['vans_standard'],
  
  // Specialized equipment is typically exclusive
  power_only: ['power_only'],
  container: ['container'],
  car_carrier: ['car_carrier'],
  tanker: ['tanker'],
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