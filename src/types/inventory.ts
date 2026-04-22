export interface Location {
  id: string;
  name: string;
  location_type_id: string;
  location_type?: { name: string } | null;
  address?: string;
  parent_location_id?: string;
  active: boolean;
  created_at: string;
  last_event_id: string;
}
