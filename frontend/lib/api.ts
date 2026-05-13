// ─── Types ───────────────────────────────────────────────────────────────────

export type Role = 'MANAGER' | 'CLEANER';
export type CleaningStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'FLAGGED';
/** @deprecated use CleaningStatus */
export type EventStatus = CleaningStatus;
export type BookingStatus = 'CONFIRMED' | 'CANCELLED';
export type CleaningType = 'CHECKOUT' | 'MIDSTAY' | 'DEEP';
export type BookingChannel = 'AIRBNB' | 'BOOKING_COM' | 'VRBO' | 'EXPEDIA' | 'DIRECT' | 'OTHER';
export type AssignmentStatus = 'ASSIGNED' | 'STARTED' | 'COMPLETED' | 'REJECTED' | 'REASSIGNED';

// ─── Incidents types ───
export type IncidentStatus = 'OPEN' | 'SCHEDULED' | 'RESOLVED' | 'CLOSED';
export type IncidentPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncidentType =
  | 'CLEANING'
  | 'BOILER_INSPECTION'
  | 'ACCIDENT'
  | 'PHOTO_SHOOT'
  | 'REPAIR'
  | 'GENERAL';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  language: string;
  tenantId: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  cleaningsPoolFilter?: {
    propertyIds: string[];
  };
  [key: string]: any;
}

export interface Property {
  id: string;
  name: string;
  address?: string;
  locationLat?: number;
  locationLng?: number;
  pmsPropertyId?: string;
  defaultCleanerId?: string;
}

export interface Assignment {
  id: string;
  userId: string;
  isPrimary: boolean;
  status: AssignmentStatus;
  startedAt?: string;
  completedAt?: string;
  user: { id: string; name: string; email: string };
  assignedBy?: { id: string; name: string };
  photos: Photo[];
}

export interface Photo {
  id: string;
  url: string;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface Booking {
  id: string;
  tenantId: string;
  propertyId: string;
  bookingRef: string;
  pmsBookingId?: string;
  status: BookingStatus;
  cancelledAt?: string | null;
  checkInTime: string;
  checkOutTime?: string;
  accommodationName: string;
  accommodationType?: string;
  numAdults: number;
  numChildren: number;
  channel: BookingChannel;
  pmsLastSyncedAt?: string;
  property?: Property;
  cleaning?: Cleaning | null;
  createdAt: string;
  updatedAt: string;
}

export interface Cleaning {
  id: string;
  tenantId: string;
  propertyId: string;
  bookingId: string;

  cleaningType: CleaningType;
  status: CleaningStatus;
  timeSlot: string;
  maxCleaners: number;

  managerNote?: string;
  supplyNote?: string;
  cleanerNote?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;

  // Denormalized booking fields (read-only \u2014 sync owns them)
  bookingRef: string;
  checkInTime: string;
  checkOutTime?: string;
  accommodationName: string;
  numAdults: number;
  numChildren: number;
  channel: BookingChannel;
  pmsLastSyncedAt?: string;

  // When the underlying booking was cancelled. Cleaning may still be active.
  bookingCancelledAt?: string | null;

  property?: Property;
  booking?: { id: string; bookingRef: string; pmsBookingId?: string; status: BookingStatus; cancelledAt?: string | null };
  assignments: Assignment[];
  tags?: { tag: Tag }[];
  photos: Photo[];
}

/** @deprecated use Cleaning */
export type CleaningEvent = Cleaning;

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  payload?: Record<string, any>;
}

export interface PlanningBooking {
  id: string;
  cleaningId?: string;
  pmsBookingId?: string;
  bookingRef: string;
  accommodationName: string;
  accommodationType?: string;
  propertyId?: string;
  pmsPropertyId?: string;
  checkInTime: string;
  checkOutTime?: string;
  timeSlot?: string;
  numAdults: number;
  numChildren: number;
  channel: BookingChannel;
  status?: CleaningStatus;
  bookingStatus: BookingStatus;
  bookingCancelledAt?: string | null;
  assignments: {
    id: string;
    userId: string;
    userName: string;
    isPrimary: boolean;
    status: AssignmentStatus;
  }[];
}

export interface DayStats {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  overdue: number;
}

// ─── Incident types ─────

export interface IncidentUserRef {
  id: string;
  name: string | null;
  email: string;
}

export interface IncidentAttachment {
  id: string;
  url: string;
  mimeType: string | null;
  createdAt: string;
}

export interface IncidentListItem {
  id: string;
  type: IncidentType;
  status: IncidentStatus;
  priority: IncidentPriority;
  title: string;
  propertyId: string | null;
  isGeneral: boolean;
  bookingId: string | null;
  cleaningId: string | null;
  /** @deprecated use cleaningId */
  cleaningEventId?: string | null;
  createdAt: string;
  updatedAt: string;
  property: { id: string; name: string } | null;
  reportedBy: IncidentUserRef | null;
  assignedTo: IncidentUserRef | null;
  _count?: { attachments: number };
}

export interface Incident extends IncidentListItem {
  description: string | null;
  scheduledFor: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  property: { id: string; name: string; address?: string | null } | null;
  resolvedBy: IncidentUserRef | null;
  cleaning: {
    id: string;
    accommodationName: string;
    timeSlot: string;
    checkInTime: string;
    booking?: { id: string; bookingRef: string } | null;
  } | null;
  booking: {
    id: string;
    bookingRef: string;
    accommodationName: string;
    checkInTime: string;
  } | null;
  /** @deprecated use cleaning */
  cleaningEvent?: any;
  attachments: IncidentAttachment[];
}

export interface IncidentListResponse {
  rows: IncidentListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface IncidentFilters {
  status?: IncidentStatus;
  type?: IncidentType;
  priority?: IncidentPriority;
  propertyId?: string;
  assignedToId?: string;
  isGeneral?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CreateIncidentPayload {
  type: IncidentType;
  priority?: IncidentPriority;
  title: string;
  description?: string;
  propertyId?: string;
  isGeneral?: boolean;
  bookingId?: string;
  cleaningId?: string;
  assignedToId?: string;
  scheduledFor?: string;
}

export interface UpdateIncidentPayload {
  type?: IncidentType;
  status?: IncidentStatus;
  priority?: IncidentPriority;
  title?: string;
  description?: string;
  assignedToId?: string | null;
  scheduledFor?: string | null;
  resolutionNote?: string;
}

// ─── API Client ───────────────────────────────────────────────────────────────

const BASE = '/api/v1';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cleanops_token');
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || 'Request failed');
  }

  return res.json();
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface VerifyResponse {
  setupToken: string;
  email: string;
  name: string;
  isFirstTime: boolean;
}

export const auth = {
  login: (email: string, password: string) =>
    post<{ accessToken: string; user: User }>('/auth/login', { email, password }),

  requestMagicLink: (email: string) =>
    post<{ message: string; _dev_token?: string }>(
      '/auth/magic-link', { email }
    ),

  verify: (token: string) =>
    post<VerifyResponse>('/auth/verify', { token }),

  setPassword: (setupToken: string, password: string) =>
    post<{ accessToken: string; user: User }>('/auth/set-password', {
      setupToken,
      password,
    }),

  me: () => get<User>('/auth/me'),
  logout: () => post('/auth/logout'),
};

// ─── Cleanings ────────────────────────────────────────────────────────────────

export interface MarkDoneResponse {
  done: true;
  needsIncident: boolean;
  incidentId: string | null;
  cleaning: Cleaning;
}

export interface ClaimResponse {
  cleaning: Cleaning;
  assignment: Assignment;
}

export const events = {
  byDate: (date: string) =>
    get<Cleaning[]>(`/cleanings?date=${date}`),
  byDateRange: (from: string, to: string) =>
    get<Cleaning[]>(`/cleanings?from=${from}&to=${to}`),
  stats: (date: string) =>
    get<DayStats>(`/cleanings/stats?date=${date}`),
  overdue: () =>
    get<Cleaning[]>('/cleanings/overdue'),
  calendar: (year: number, month: number) =>
    get<{ statusCounts: Record<string, number>; dailyCounts: { day: string; count: number }[] }>(
      `/cleanings/calendar/${year}/${month}`
    ),
  byId: (id: string) =>
    get<Cleaning>(`/cleanings/${id}`),
  // create() removed \u2014 cleanings now only come from the Avantio sync
  update: (id: string, data: { timeSlot?: string; cleaningType?: CleaningType; managerNote?: string; supplyNote?: string; maxCleaners?: number }) =>
    patch<Cleaning>(`/cleanings/${id}`, data),
  cancel: (id: string) =>
    del<Cleaning>(`/cleanings/${id}`),

  // ─── Pool lifecycle ───
  pool: () =>
    get<Cleaning[]>('/cleanings/pool'),
  mine: (from?: string, to?: string, propertyIds?: string[]) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (propertyIds && propertyIds.length > 0) {
      params.set('propertyIds', propertyIds.join(','));
    }
    const q = params.toString();
    return get<Cleaning[]>(`/cleanings/mine${q ? `?${q}` : ''}`);
  },
  claim: (cleaningId: string) =>
    post<ClaimResponse>(`/cleanings/${cleaningId}/claim`),
  drop: (cleaningId: string) =>
    post<{ dropped: true; cleaning: Cleaning }>(`/cleanings/${cleaningId}/drop`),
  markDone: (
    cleaningId: string,
    body: {
      allGood: boolean;
      note?: string;
      photoUrls?: string[];
      priority?: IncidentPriority;
    },
  ) => patch<MarkDoneResponse>(`/cleanings/${cleaningId}/done`, body),
  releaseToPool: (cleaningId: string) =>
    post<{ released: true; affectedUserIds: string[]; cleaning: Cleaning }>(
      `/cleanings/${cleaningId}/release-to-pool`
    ),
};

/** Alias for clarity \u2014 same as `events` namespace */
export const cleanings = events;

// ─── Assignments ──────────────────────────────────────────────────────────────

export const assignments = {
  mine: (date: string) =>
    get<Assignment[]>(`/assignments/my?date=${date}`),
  assign: (cleaningId: string, userId: string) =>
    post('/assignments/assign', { cleaningId, userId }),
  reassign: (cleaningId: string, oldUserId: string, newUserId: string) =>
    post('/assignments/reassign', { cleaningId, oldUserId, newUserId }),
  start: (id: string) =>
    patch(`/assignments/${id}/start`),
  complete: (id: string, cleanerNote?: string) =>
    patch(`/assignments/${id}/complete`, { cleanerNote }),
  reject: (id: string, reason?: string) =>
    patch(`/assignments/${id}/reject`, { reason }),
};

// ─── Bookings ─────────────────────────────────────────────────────────────────

export interface BookingDetail extends Booking {
  cleaning?: Cleaning | null;
}

export const bookings = {
  list: (query?: {
    arrivalFrom?: string;
    arrivalTo?: string;
    status?: BookingStatus;
    propertyId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (query?.arrivalFrom) params.set('arrivalFrom', query.arrivalFrom);
    if (query?.arrivalTo) params.set('arrivalTo', query.arrivalTo);
    if (query?.status) params.set('status', query.status);
    if (query?.propertyId) params.set('propertyId', query.propertyId);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    const q = params.toString();
    return get<{ rows: Booking[]; total: number; limit: number; offset: number }>(
      `/bookings${q ? `?${q}` : ''}`,
    );
  },
  byId: (id: string) => get<BookingDetail>(`/bookings/${id}`),
  update: (id: string, data: { checkInTime?: string; checkOutTime?: string; accommodationName?: string; numAdults?: number; numChildren?: number }) =>
    patch<Booking>(`/bookings/${id}`, data),
  cancel: (id: string) =>
    post<Booking>(`/bookings/${id}/cancel`),
};

// ════════════════════════════════════════════════════════════════════
// APPEND TO frontend/lib/api.ts
// Paste this section BEFORE the `// ─── Users ───` section.
// ════════════════════════════════════════════════════════════════════

// ─── Streams ──────────────────────────────────────────────────────────────────

export type StreamItemType =
  | 'RESERVATION'
  | 'CLEANING'
  | 'INCIDENT'
  | 'REPAIR'
  | 'INSPECTION'
  | 'MANUAL';

export type StreamEventCategory = 'MANUAL' | 'NOTE' | 'REPAIR' | 'INSPECTION';

export interface StreamItem {
  id: string;
  type: StreamItemType;
  occurredAt: string;
  propertyId: string | null;
  propertyName: string | null;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  photoUrls?: string[];
  status?: string;
  priority?: string;
  source: { kind: 'booking' | 'cleaning' | 'incident' | 'manual'; id: string };
  authorName?: string;
}

export interface StreamFeed {
  items: StreamItem[];
  nextCursor: string | null;
}

export interface ManualStreamEvent {
  id: string;
  tenantId: string;
  propertyId: string | null;
  authorId: string;
  category: StreamEventCategory;
  title: string;
  description: string | null;
  photoUrls: string[];
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  property?: { id: string; name: string } | null;
  author?: { id: string; name: string; email: string };
}

export const streams = {
  feed: (params?: {
    propertyId?: string;
    cursor?: string;
    limit?: number;
    types?: StreamItemType[];
    from?: string;
    to?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.propertyId) q.set('propertyId', params.propertyId);
    if (params?.cursor) q.set('cursor', params.cursor);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.types?.length) q.set('types', params.types.join(','));
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return get<StreamFeed>(`/streams${qs ? `?${qs}` : ''}`);
  },

  createManual: (data: {
    category?: StreamEventCategory;
    title: string;
    description?: string;
    propertyId?: string | null;
    photoUrls?: string[];
    occurredAt?: string;
  }) => post<ManualStreamEvent>('/streams/manual', data),

  updateManual: (id: string, data: {
    category?: StreamEventCategory;
    title?: string;
    description?: string;
    propertyId?: string | null;
    photoUrls?: string[];
    occurredAt?: string;
  }) => patch<ManualStreamEvent>(`/streams/manual/${id}`, data),

  deleteManual: (id: string) =>
    del<{ deleted: true }>(`/streams/manual/${id}`),
};


// ─── Users ────────────────────────────────────────────────────────────────────

export const users = {
  list: () => get<User[]>('/users'),
  workload: (date: string) =>
    get<(User & { assignmentCount: number })[]>(`/users/cleaners/workload?date=${date}`),
  create: (data: { name: string; email: string; role: Role; language: string }) =>
    post<User>('/users', data),
  update: (id: string, data: Partial<User> & { preferences?: UserPreferences }) =>
    patch<User>(`/users/${id}`, data),
  /**
   * Self-service preference update — works for any logged-in user (cleaner or
   * manager) and only updates the `preferences` JSON column.
   */
  updateMyPreferences: (preferences: UserPreferences) =>
    patch<User>('/users/me/preferences', { preferences }),
  deactivate: (id: string) =>
    del(`/users/${id}`),
};

// ─── Properties ───────────────────────────────────────────────────────────────

export const properties = {
  list: () => get<Property[]>('/properties'),
  byId: (id: string) => get<Property>(`/properties/${id}`),
  create: (data: Partial<Property>) => post<Property>('/properties', data),
  update: (id: string, data: Partial<Property>) => patch<Property>(`/properties/${id}`, data),
  delete: (id: string) => del(`/properties/${id}`),
};

// ─── Tags ─────────────────────────────────────────────────────────────────────

export const tags = {
  list: () => get<Tag[]>('/tags'),
  create: (name: string, color?: string) => post<Tag>('/tags', { name, color }),
  delete: (id: string) => del(`/tags/${id}`),
  addToEvent: (eventId: string, tagId: string) =>
    post(`/tags/event/${eventId}/tag/${tagId}`),
  removeFromEvent: (eventId: string, tagId: string) =>
    del(`/tags/event/${eventId}/tag/${tagId}`),
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications = {
  list: () => get<Notification[]>('/notifications'),
  unreadCount: () => get<{ count: number }>('/notifications/unread/count'),
  markRead: (id: string) => patch(`/notifications/${id}/read`),
  markAllRead: () => patch('/notifications/read-all'),
};

// ─── Incidents ────────────────────────────────────────────────────────────────

export const incidents = {
  list: (filters: IncidentFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, String(v));
      }
    });
    const q = params.toString();
    return get<IncidentListResponse>(`/incidents${q ? `?${q}` : ''}`);
  },
  byId: (id: string) => get<Incident>(`/incidents/${id}`),
  create: (data: CreateIncidentPayload) =>
    post<Incident>('/incidents', data),
  update: (id: string, data: UpdateIncidentPayload) =>
    patch<Incident>(`/incidents/${id}`, data),
  addAttachment: (id: string, data: { url: string; mimeType?: string }) =>
    post<IncidentAttachment>(`/incidents/${id}/attachments`, data),
  deleteAttachment: (id: string, attachmentId: string) =>
    del<{ deleted: true }>(`/incidents/${id}/attachments/${attachmentId}`),
};

// ─── Integrations / Planning ──────────────────────────────────────────────────

export const integrations = {
  sync: () => post('/integrations/sync'),
  syncAccommodations: () => post('/integrations/sync/accommodations'),
  testConnection: () => post<{ connected: boolean; error?: string }>('/integrations/test-connection'),
  planning: {
    list: (filters: {
      arrivalFrom?: string;
      arrivalTo?: string;
      creationDateFrom?: string;
      creationDateTo?: string;
      status?: string;
    }) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
      return get<PlanningBooking[]>(`/integrations/planning/bookings?${params}`);
    },
    detail: (pmsBookingId: string) =>
      get(`/integrations/planning/bookings/${pmsBookingId}`),
    updateTimes: (pmsBookingId: string, data: { checkInTime?: string; checkOutTime?: string }) =>
      patch(`/integrations/planning/bookings/${pmsBookingId}`, data),
  },
};

// ─── Tenant ───────────────────────────────────────────────────────────────────

export const tenant = {
  get: () => get('/tenant'),
  updatePmsConfig: (data: {
    pmsProvider?: string;
    pmsApiBaseUrl?: string;
    pmsApiKey?: string;
    pmsSyncEnabled?: boolean;
  }) => patch('/tenant/pms-config', data),
};

// ─── Uploads ──────────────────────────────────────────────────────────────────

export type MediaEventType =
  | 'cleaning'
  | 'incident'
  | 'manual'
  | 'repair'
  | 'inspection';

export interface SignedUploadResponse {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  expiresAt: string;
}

export const uploads = {
  /**
   * Step 1 of the upload flow: ask the backend for a signed URL to PUT the file
   * directly to GCS. Returns the URL + the canonical publicUrl to store in the DB.
   */
  getSignedUrl: (params: {
    propertyId?: string;
    pmsPropertyId?: string;
    eventType: MediaEventType;
    contentType: string;
    sizeBytes?: number;
  }) => post<SignedUploadResponse>('/uploads/signed-url', params),

  /**
   * Step 2: PUT the file directly to GCS. Bypasses the backend, so the upload
   * isn't capped by Railway proxy timeouts. The Authorization header MUST NOT
   * be set on this request (GCS rejects it).
   */
  putToGcs: async (uploadUrl: string, file: File): Promise<void> => {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!res.ok) {
      throw new ApiError(res.status, `GCS upload failed: ${res.statusText}`);
    }
  },

  /**
   * Convenience helper: do steps 1 + 2 in one call. Returns the publicUrl
   * (= the canonical object URL stored in the DB after the photo is referenced
   * by an incident or cleaning event).
   */
  uploadToGcs: async (params: {
    file: File;
    eventType: MediaEventType;
    propertyId?: string;
    pmsPropertyId?: string;
  }): Promise<{ publicUrl: string; key: string }> => {
    const signed = await uploads.getSignedUrl({
      propertyId: params.propertyId,
      pmsPropertyId: params.pmsPropertyId,
      eventType: params.eventType,
      contentType: params.file.type,
      sizeBytes: params.file.size,
    });
    await uploads.putToGcs(signed.uploadUrl, params.file);
    return { publicUrl: signed.publicUrl, key: signed.key };
  },

  /**
   * For displaying private bucket photos: ask backend for a short-lived
   * signed READ URL (default 1 hour TTL).
   */
  getReadUrl: (key: string, ttlMinutes?: number) =>
    post<{ url: string }>('/uploads/read-url', { key, ttlMinutes }),

  /**
   * Legacy multipart upload. Kept for back-compat with code that hasn't
   * been migrated to the signed-URL flow yet.
   */
  photo: async (eventId: string, file: File) => {
    const token = getToken();
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch(`${BASE}/uploads/event/${eventId}/photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new ApiError(res.status, 'Upload failed');
    return res.json() as Promise<{ id: string; url: string }>;
  },
};

export { ApiError };