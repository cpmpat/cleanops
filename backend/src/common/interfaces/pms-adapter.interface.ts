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
  /** True when the PMS gave no usable time and the house default was applied. */
  checkInAssumed?: boolean;
  checkOutTime?: string;         // ISO datetime
  checkOutAssumed?: boolean;
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

/**
 * What a pull actually achieved.
 *
 * `failedIds` is the part that matters: booking ids the list endpoint handed
 * us and the detail fetch (or the mapper) then refused. They used to be logged
 * and forgotten while the sync watermark advanced past them, which is how
 * bookings went missing permanently. The caller is expected to persist them
 * and ask again.
 */
export interface PmsPullResult {
  bookings: PmsBooking[];
  failedIds: Array<{ pmsBookingId: string; reason: string }>;
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
  pullBookings(since: Date, tenantConfig: PmsTenantConfig): Promise<PmsPullResult>;

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
