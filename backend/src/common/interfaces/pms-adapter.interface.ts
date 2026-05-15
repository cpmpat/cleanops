/**
 * PMS Adapter Interface
 *
 * Every PMS integration (Avantio, Guesty, Hostaway, generic webhook)
 * must implement this interface. This ensures the Booking Sync Service
 * can work with any PMS without knowing the specifics.
 */

export interface PmsBooking {
  pmsBookingId: string;          // unique ID in the PMS
  bookingRef: string;            // human-readable reference
  checkInTime: string;           // ISO datetime
  checkOutTime?: string;         // ISO datetime
  pmsPropertyId?: string;        // accommodation ID in PMS (links to PmsAccommodation.pmsId)
  numAdults: number;
  numChildren: number;
  channel: string;               // "Airbnb", "Booking.com", etc.
  status: 'active' | 'cancelled' | 'modified';
  guestName?: string;
  guestEmail?: string;
  rawData?: any;                 // full PMS response for debugging
  isOwnerStay?: boolean;
}

export interface PmsAccommodation {
  pmsId: string;                 // Avantio accommodation.id (e.g. "562885")
  name: string;                  // "U Mlýnského Kanálu 14, unit 122 - Praha"
  type: string;                  // "STUDIO", "APARTMENT", "VILLA", etc.
  status: string;                // "ENABLED", "DISABLED", "DELETED"
  clean: boolean;                // PMS-side clean flag
  rawData?: any;
}

export interface PmsAdapter {
  /**
   * Pull all accommodations from PMS.
   * Used to sync property names, types, and statuses.
   */
  pullAccommodations(tenantConfig: PmsTenantConfig): Promise<PmsAccommodation[]>;

  /**
   * Pull bookings from PMS.
   * @param since - Only return bookings modified after this date
   */
  pullBookings(since: Date, tenantConfig: PmsTenantConfig): Promise<PmsBooking[]>;

  /**
   * Push check-in/check-out time updates back to PMS.
   * Only checkInTime and checkOutTime are writable.
   */
  updateBookingTimes(
    pmsBookingId: string,
    data: { checkInTime?: string; checkOutTime?: string },
    tenantConfig: PmsTenantConfig,
  ): Promise<void>;

  /**
   * Test the connection to the PMS.
   */
  testConnection(tenantConfig: PmsTenantConfig): Promise<boolean>;
}

export interface PmsTenantConfig {
  apiBaseUrl: string;
  apiKey: string;
  additionalHeaders?: Record<string, string>;
  options?: Record<string, any>;
}
