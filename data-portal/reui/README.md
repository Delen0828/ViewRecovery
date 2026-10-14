# ReUI Gantt core

The Gantt provider, state engine, date utilities, recurrence support, and types
come from the free ReUI registry at https://reui.io/r/gantt.json (retrieved
October 13, 2026). Documentation: https://reui.io/components/gantt.

Local adaptations replace registry import aliases with relative paths and the
root's class-name concatenation helper with a local function. The portal uses
ReUI's documented custom-view composition: `Gantt`, `useGanttNavigation`, and
`useGanttOccurrences` drive `schedule-gantt.jsx`, while HeroUI controls and portal
styles render the timeline. Only scheduled users in the displayed date range
appear, with their names on compact 16px bars and no user column; bar dragging,
resizing, and slot selection are disabled. Schedule changes stay in the existing
session editor and preview immediately. The date-range bars retain the portal's
inclusive daily scheduling and Eastern Time handling.
