'use client';
import FullCalendar from '@fullcalendar/react';
import resourceTimelinePlugin from '@fullcalendar/resource-timeline';
import interactionPlugin from '@fullcalendar/interaction';
import { useState } from 'react';
import type { CleaningEvent, Property, User } from '@/lib/api';
import { formatTime } from '@/lib/utils';

interface ScheduleCalendarProps {
  weekStart: string;
  events: CleaningEvent[];
  properties: Property[];
  cleaners: User[];
  onEventClick: (event: CleaningEvent) => void;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:     '#f59e0b',
  ASSIGNED:    '#3b82f6',
  IN_PROGRESS: '#8b5cf6',
  COMPLETED:   '#10b981',
  CANCELLED:   '#9ca3af',
  FLAGGED:     '#ef4444',
};

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  event: CleaningEvent | null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function ScheduleCalendar({
  weekStart, events, properties, cleaners, onEventClick,
}: ScheduleCalendarProps) {
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, event: null });

  const resources = properties
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({
      id: p.id,
      title: p.name,
      extendedProps: { pmsId: p.pmsPropertyId },
    }));

  const calEvents: any[] = [];

  events
    .filter(e => e.status !== 'CANCELLED')
    .forEach(e => {
      const arrivalDate = e.checkInTime.split('T')[0];
      const checkoutDate = e.checkOutTime
        ? e.checkOutTime.split('T')[0]
        : arrivalDate;

      const statusColor = STATUS_COLORS[e.status] ?? STATUS_COLORS.PENDING;
      const assignees = e.assignments
        .filter(a => a.status !== 'REASSIGNED')
        .map(a => a.user.name.split(' ')[0])
        .join(', ');

      // Cleaning pill on checkout date only — no background stay bar
      calEvents.push({
        id: `clean-${e.id}`,
        resourceId: e.propertyId,
        start: checkoutDate,
        end: addDays(checkoutDate, 1), // single day block
        backgroundColor: statusColor,
        borderColor: statusColor,
        textColor: '#ffffff',
        extendedProps: {
          event: e,
          assignees,
          checkInTime: e.checkInTime,
          checkOutTime: e.checkOutTime,
          isCleaning: true,
        },
      });
    });

  return (
    <div className="h-full fc-cleanops relative">
      <style>{`
        .fc-cleanops .fc-scrollgrid { border: none !important; }
        .fc-cleanops table { border-color: #e5e1db !important; }

        /* Day header */
        .fc-cleanops .fc-col-header-cell {
          background: #faf9f7;
          padding: 8px 0;
          border-color: #e5e1db !important;
        }
        .fc-cleanops .fc-col-header-cell-cushion {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #6b6560;
          text-decoration: none !important;
        }

        /* Today */
        .fc-cleanops .fc-day-today { background: #eff6ff !important; }
        .fc-cleanops .fc-day-today .fc-col-header-cell-cushion { color: #2563eb !important; }

        /* Resource label */
        .fc-cleanops .fc-datagrid-cell-main { font-size: 12px; font-weight: 600; color: #1a1714; }
        .fc-cleanops .fc-datagrid-cell-cushion { padding: 8px 12px; }

        /* Row borders */
        .fc-cleanops .fc-datagrid-cell,
        .fc-cleanops .fc-timeline-lane { border-color: #f0ede9 !important; }

        /* Divider */
        .fc-cleanops .fc-resource-timeline-divider { width: 3px; background: #e5e1db; cursor: default; }

        /* Slot lines */
        .fc-cleanops .fc-timeline-slot { border-color: #e5e1db !important; }

        /* Background stay bar — subtle, no border */
        .fc-cleanops .fc-bg-event {
          border-radius: 6px !important;
          opacity: 1 !important;
          margin: 6px 3px !important;
        }

        /* Cleaning dot/pill — compact, sits inside the day cell */
        .fc-cleanops .fc-timeline-event {
          border-radius: 20px !important;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          cursor: pointer;
          border: none !important;
          margin: 10px 4px 4px 4px;
          min-width: 28px;
          max-height: 26px;
          transition: filter 0.15s, transform 0.1s;
        }
        .fc-cleanops .fc-timeline-event:hover {
          filter: brightness(1.1);
          transform: scale(1.04);
        }

        /* Hide toolbar */
        .fc-cleanops .fc-toolbar { display: none; }

        /* Scrollbar */
        .fc-cleanops .fc-scroller::-webkit-scrollbar { height: 6px; width: 6px; }
        .fc-cleanops .fc-scroller::-webkit-scrollbar-thumb { background: #e5e1db; border-radius: 3px; }
      `}</style>

      <FullCalendar
        plugins={[resourceTimelinePlugin, interactionPlugin]}
        initialView="resourceTimelineWeek"
        initialDate={weekStart}
        key={weekStart}
        resources={resources}
        events={calEvents}

        slotDuration={{ days: 1 }}
        slotLabelFormat={{ weekday: 'short', day: 'numeric', omitCommas: true }}

        resourceAreaHeaderContent="Unit"
        resourceAreaWidth="260px"
        height="100%"
        headerToolbar={false}
        resourceOrder="title"
        firstDay={1}
        nowIndicator={false}
        weekends

        eventClick={(info) => {
          const e = info.event.extendedProps.event as CleaningEvent;
          if (e) onEventClick(e);
        }}

        eventMouseEnter={(info) => {
          const rect = info.el.getBoundingClientRect();
          const e = info.event.extendedProps.event as CleaningEvent;
          setTooltip({
            visible: true,
            x: rect.left + rect.width / 2,
            y: rect.top - 8,
            event: e,
          });
        }}

        eventMouseLeave={() => {
          setTooltip({ visible: false, x: 0, y: 0, event: null });
        }}

        resourceLabelContent={(arg) => (
          <div className="py-0.5">
            <p className="text-xs font-semibold text-ink truncate max-w-[220px]" title={arg.resource.title}>
              {arg.resource.title}
            </p>
            {arg.resource.extendedProps.pmsId && (
              <p className="text-[10px] text-ink-faint font-mono leading-none mt-0.5">
                #{arg.resource.extendedProps.pmsId}
              </p>
            )}
          </div>
        )}

        eventContent={(arg) => {
          const assignees = arg.event.extendedProps.assignees as string;
          const isUnassigned = !assignees;

          return (
            <div className="flex items-center gap-1 px-1 overflow-hidden w-full h-full">
              {/* Small dot indicator */}
              <span className="w-2 h-2 rounded-full bg-white/40 flex-shrink-0" />
              <span className="truncate text-[11px] font-bold leading-tight">
                {isUnassigned ? '⚠ Unassigned' : assignees}
              </span>
            </div>
          );
        }}
      />

      {/* Hover tooltip */}
      {tooltip.visible && tooltip.event && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-ink text-white text-xs rounded-xl px-3.5 py-3 shadow-modal min-w-[180px]">
            <p className="font-bold text-sm truncate max-w-[220px] mb-2">
              {tooltip.event.accommodationName}
            </p>

            <div className="space-y-1 text-white/80">
              <div className="flex justify-between gap-4">
                <span>Check-in</span>
                <span className="text-white font-semibold">{formatTime(tooltip.event.checkInTime)}</span>
              </div>
              {tooltip.event.checkOutTime && (
                <div className="flex justify-between gap-4">
                  <span>Check-out</span>
                  <span className="text-white font-semibold">{formatTime(tooltip.event.checkOutTime)}</span>
                </div>
              )}
              {tooltip.event.assignments.filter(a => a.status !== 'REASSIGNED').length > 0 && (
                <div className="pt-1.5 mt-1.5 border-t border-white/20 text-white/70">
                  {tooltip.event.assignments
                    .filter(a => a.status !== 'REASSIGNED')
                    .map(a => a.user.name)
                    .join(', ')}
                </div>
              )}
            </div>

            {/* Arrow */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full">
              <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-ink" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
