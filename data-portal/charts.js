import * as d3 from "d3";
import { TASK_COLORS } from "./task-colors.js";
export { TASK_COLORS } from "./task-colors.js";

// The existing aggregation, session ordering, task toggles and chart interactions
// are retained here, independent of the React/HeroUI application shell.
const TASKS = Object.keys(TASK_COLORS);
const easternDateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const sessionDateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});
export function renderPortalChart(
  container,
  { data, userId, type, visibleTasks, task = "Motion", metrics },
) {
  const state = {
    users: {
      accuracySeries: normalizeAggregatedAccuracySeries(data?.accuracy_series),
      durationSeries: normalizeAggregatedDurationSeries(data?.duration_series),
      difficultySeries: normalizeAggregatedDifficultySeries(
        data?.difficulty_series,
      ),
      visibleTasks,
    },
  };
  const getPlottedTasks = () => TASKS;
  const isDeploymentTaskVisible = () => true;
  const formatUserLabel = (id) => `User ${id}`;
  if (type === "accuracy")
    renderUserTrendChart(container, aggregateUserTrendSeries([], userId));
  else if (type === "duration")
    renderUserDurationTrendChart(
      container,
      aggregateUserDurationTrendSeries([], userId),
    );
  else if (type === "difficulty")
    renderUserDifficultyTrendChart(
      container,
      aggregateUserDifficultyTrendSeries([], userId, task),
      task,
    );
  else if (type === "difficulty-duration")
    renderUserDurationDifficultyTrendChart(
      container,
      aggregateUserDurationDifficultyTrendSeries([], userId, task),
      task,
    );
  else if (type === "preview")
    renderDifficultyChart(
      container,
      (metrics?.levels || []).map((level) => ({
        ...level,
        sortValue: Number(level.level),
      })),
    );
  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "0%";
    }

    return `${Math.round(number)}%`;
  }

  function parseFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function parseApiDate(value) {
    const match = String(value || "").match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
    );
    if (match) {
      return new Date(
        Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        ),
      );
    }

    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? new Date(NaN) : date;
  }

  function normalizeSessionIndex(value) {
    const sessionIndex = Number(value);
    return Number.isInteger(sessionIndex) && sessionIndex > 0
      ? sessionIndex
      : 0;
  }

  function normalizeSessionLabel(value, sessionIndex) {
    const label = String(value || "").trim();
    return label || (sessionIndex > 0 ? `Session ${sessionIndex}` : "Session");
  }

  function normalizeAggregatedAccuracySeries(series) {
    if (!Array.isArray(series)) {
      return [];
    }

    return series
      .map((point) => {
        const userId = String(point.userId || "").trim() || "Unknown";
        const task = String(point.task || "").trim();
        const date = parseApiDate(point.dateLocal);
        if (!task || Number.isNaN(date.getTime())) {
          return null;
        }

        const total = Number(point.total) || 0;
        const correct = Number(point.correct) || 0;
        const sessionIndex = normalizeSessionIndex(point.sessionIndex);
        return {
          userId,
          userLabel: String(point.userLabel || formatUserLabel(userId)),
          task,
          date,
          dateKey: String(point.dateKey || formatDateKey(date)),
          fileName: String(point.fileName || ""),
          sessionIndex,
          sessionLabel: normalizeSessionLabel(point.sessionLabel, sessionIndex),
          accuracy: Number.isFinite(Number(point.accuracy))
            ? Number(point.accuracy)
            : total
              ? (correct / total) * 100
              : 0,
          correct,
          total,
        };
      })
      .filter(Boolean);
  }

  function normalizeAggregatedDurationSeries(series) {
    if (!Array.isArray(series)) {
      return [];
    }

    return series
      .map((point) => {
        const userId = String(point.userId || "").trim() || "Unknown";
        const task = String(point.task || "").trim();
        const date = parseApiDate(point.dateLocal);
        if (!task || Number.isNaN(date.getTime())) {
          return null;
        }

        const sessionIndex = normalizeSessionIndex(point.sessionIndex);
        return {
          userId,
          userLabel: String(point.userLabel || formatUserLabel(userId)),
          task,
          date,
          dateKey: String(point.dateKey || formatDateKey(date)),
          fileName: String(point.fileName || ""),
          sessionIndex,
          sessionLabel: normalizeSessionLabel(point.sessionLabel, sessionIndex),
          durationMs: Number(point.durationMs) || 0,
          trainingMs: Number(point.trainingMs) || 0,
          restingMs: Number(point.restingMs) || 0,
          sessions: Number(point.sessions) || 0,
        };
      })
      .filter(Boolean);
  }

  function normalizeAggregatedDifficultySeries(series) {
    if (!Array.isArray(series)) {
      return [];
    }

    return series
      .map((point) => {
        const userId = String(point.userId || "").trim() || "Unknown";
        const task = String(point.task || "").trim();
        const difficultyLevel = String(point.difficultyLevel || "").trim();
        const date = parseApiDate(point.dateLocal);
        if (!task || !difficultyLevel || Number.isNaN(date.getTime())) {
          return null;
        }

        const total = Number(point.total) || 0;
        const correct = Number(point.correct) || 0;
        const sessionIndex = normalizeSessionIndex(point.sessionIndex);
        return {
          userId,
          userLabel: String(point.userLabel || formatUserLabel(userId)),
          task,
          date,
          dateKey: String(point.dateKey || formatDateKey(date)),
          fileName: String(point.fileName || ""),
          sessionIndex,
          sessionLabel: normalizeSessionLabel(point.sessionLabel, sessionIndex),
          difficultyLevel,
          difficultySortValue: point.difficultySortValue,
          durationMs: Number(point.durationMs) || 0,
          averageDurationMs: Number(point.averageDurationMs) || 0,
          accuracy: Number.isFinite(Number(point.accuracy))
            ? Number(point.accuracy)
            : total
              ? (correct / total) * 100
              : 0,
          correct,
          total,
        };
      })
      .filter(Boolean);
  }

  function formatUnit(value, unit) {
    const count = Number(value) || 0;
    return `${count} ${count === 1 ? unit : `${unit}s`}`;
  }

  function formatDurationCell(valueMs) {
    const ms = Number(valueMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      return "0s";
    }

    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) {
      return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function formatDurationTick(valueMs) {
    const ms = Number(valueMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      return "0s";
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }

    return `${Math.round(ms / 60000)}m`;
  }

  function compareDifficultySort(a, b) {
    if (typeof a.sortValue === "number" && typeof b.sortValue === "number") {
      return a.sortValue - b.sortValue;
    }

    return String(a.sortValue).localeCompare(String(b.sortValue), undefined, {
      numeric: true,
    });
  }

  function aggregateUserTrendSeries(records, userId) {
    if (state.users.accuracySeries.length) {
      return getPlottedTasks().map((task) => ({
        task,
        color: TASK_COLORS[task],
        values: state.users.accuracySeries
          .filter((point) => point.userId === userId && point.task === task)
          .sort(compareSessionOrder),
      }));
    }

    const groups = new Map();

    records.forEach((record) => {
      if (record.userId !== userId || Number.isNaN(record.date.getTime())) {
        return;
      }

      const key = `${record.fileName || record.dateKey}|${record.task}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: record.date,
          dateKey: record.dateKey,
          fileName: record.fileName,
          sessionIndex: record.sessionIndex,
          sessionLabel: record.sessionLabel,
          task: record.task,
          correct: 0,
          total: 0,
        });
      }

      const group = groups.get(key);
      group.correct += record.correct ? 1 : 0;
      group.total += 1;
    });

    return getPlottedTasks().map((task) => ({
      task,
      color: TASK_COLORS[task],
      values: Array.from(groups.values())
        .filter((group) => group.task === task)
        .sort(compareSessionOrder)
        .map((group) => ({
          date: group.date,
          dateKey: group.dateKey,
          fileName: group.fileName,
          sessionIndex: group.sessionIndex,
          sessionLabel: group.sessionLabel,
          accuracy: group.total ? (group.correct / group.total) * 100 : 0,
          correct: group.correct,
          total: group.total,
        })),
    }));
  }

  function aggregateUserDurationTrendSeries(sessions, userId) {
    if (state.users.durationSeries.length) {
      return getPlottedTasks().map((task) => ({
        task,
        color: TASK_COLORS[task],
        values: state.users.durationSeries
          .filter(
            (point) =>
              point.userId === userId &&
              point.task === task &&
              isDeploymentTaskVisible(point.task),
          )
          .sort(compareSessionOrder),
      }));
    }

    return getPlottedTasks().map((task) => ({
      task,
      color: TASK_COLORS[task],
      values: sessions
        .filter(
          (session) =>
            session.userId === userId &&
            session.task === task &&
            !Number.isNaN(session.date.getTime()) &&
            isDeploymentTaskVisible(session.task),
        )
        .sort(compareSessionOrder),
    }));
  }

  function aggregateUserDifficultyTrendSeries(records, userId, task) {
    if (state.users.difficultySeries.length) {
      const bySession = new Map();
      state.users.difficultySeries.forEach((point) => {
        if (
          point.userId !== userId ||
          point.task !== task ||
          Number.isNaN(point.date.getTime())
        ) {
          return;
        }

        const sessionKey = point.fileName || String(point.sessionIndex);
        if (!bySession.has(sessionKey)) {
          bySession.set(sessionKey, {
            date: point.date,
            dateKey: point.dateKey,
            fileName: point.fileName,
            sessionIndex: point.sessionIndex,
            sessionLabel: point.sessionLabel,
            values: [],
          });
        }

        bySession.get(sessionKey).values.push({
          level: point.difficultyLevel,
          sortValue: point.difficultySortValue,
          accuracy: point.accuracy,
          correct: point.correct,
          total: point.total,
        });
      });

      const series = Array.from(bySession.values())
        .sort(compareSessionOrder)
        .map((item) => ({
          date: item.date,
          dateKey: item.dateKey,
          fileName: item.fileName,
          sessionIndex: item.sessionIndex,
          sessionLabel: item.sessionLabel,
          values: item.values.sort(compareDifficultySort),
        }));

      const maxIndex = series.length - 1;
      return series.map((item, index) => ({
        ...item,
        opacity:
          maxIndex > 0
            ? Number((0.3 + (index / maxIndex) * 0.7).toFixed(3))
            : 1,
      }));
    }

    const groups = new Map();

    records.forEach((record) => {
      if (
        record.userId !== userId ||
        record.task !== task ||
        Number.isNaN(record.date.getTime()) ||
        !record.difficultyLevel
      ) {
        return;
      }

      const key = `${record.fileName || record.dateKey}|${record.difficultyLevel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: record.date,
          dateKey: record.dateKey,
          fileName: record.fileName,
          sessionIndex: record.sessionIndex,
          sessionLabel: record.sessionLabel,
          level: record.difficultyLevel,
          sortValue: record.difficultySortValue,
          correct: 0,
          total: 0,
        });
      }

      const group = groups.get(key);
      group.correct += record.correct ? 1 : 0;
      group.total += 1;
    });

    const bySession = new Map();
    Array.from(groups.values()).forEach((group) => {
      const sessionKey = group.fileName || String(group.sessionIndex);
      if (!bySession.has(sessionKey)) {
        bySession.set(sessionKey, {
          date: group.date,
          dateKey: group.dateKey,
          fileName: group.fileName,
          sessionIndex: group.sessionIndex,
          sessionLabel: group.sessionLabel,
          values: [],
        });
      }

      bySession.get(sessionKey).values.push({
        level: group.level,
        sortValue: group.sortValue,
        accuracy: group.total ? (group.correct / group.total) * 100 : 0,
        correct: group.correct,
        total: group.total,
      });
    });

    const series = Array.from(bySession.values())
      .sort(compareSessionOrder)
      .map((item) => ({
        date: item.date,
        dateKey: item.dateKey,
        fileName: item.fileName,
        sessionIndex: item.sessionIndex,
        sessionLabel: item.sessionLabel,
        values: item.values.sort(compareDifficultySort),
      }));

    const maxIndex = series.length - 1;
    return series.map((item, index) => ({
      ...item,
      opacity:
        maxIndex > 0 ? Number((0.3 + (index / maxIndex) * 0.7).toFixed(3)) : 1,
    }));
  }

  function aggregateUserDurationDifficultyTrendSeries(records, userId, task) {
    if (state.users.difficultySeries.length) {
      const sessions = new Map();
      state.users.difficultySeries
        .filter((point) => point.userId === userId && point.task === task)
        .forEach((point) => {
          const key = point.fileName || String(point.sessionIndex);
          if (!sessions.has(key)) sessions.set(key, { ...point, values: [] });
          sessions
            .get(key)
            .values.push({
              level: point.difficultyLevel,
              sortValue: point.difficultySortValue,
              averageDurationMs: point.averageDurationMs,
              totalDurationMs: point.durationMs,
              total: point.total,
            });
        });
      const series = [...sessions.values()].sort(compareSessionOrder);
      return series.map((item, index) => ({
        ...item,
        values: item.values.sort(compareDifficultySort),
        opacity:
          series.length > 1 ? 0.3 + (index / (series.length - 1)) * 0.7 : 1,
      }));
    }
    const groups = new Map();

    records.forEach((record) => {
      if (
        record.userId !== userId ||
        record.task !== task ||
        Number.isNaN(record.date.getTime()) ||
        !record.difficultyLevel ||
        !record.durationMs
      ) {
        return;
      }

      const key = `${record.fileName || record.dateKey}|${record.difficultyLevel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          date: record.date,
          dateKey: record.dateKey,
          fileName: record.fileName,
          sessionIndex: record.sessionIndex,
          sessionLabel: record.sessionLabel,
          level: record.difficultyLevel,
          sortValue: record.difficultySortValue,
          durationMs: 0,
          total: 0,
        });
      }

      const group = groups.get(key);
      group.durationMs += record.durationMs;
      group.total += 1;
    });

    const bySession = new Map();
    Array.from(groups.values()).forEach((group) => {
      const sessionKey = group.fileName || String(group.sessionIndex);
      if (!bySession.has(sessionKey)) {
        bySession.set(sessionKey, {
          date: group.date,
          dateKey: group.dateKey,
          fileName: group.fileName,
          sessionIndex: group.sessionIndex,
          sessionLabel: group.sessionLabel,
          values: [],
        });
      }

      bySession.get(sessionKey).values.push({
        level: group.level,
        sortValue: group.sortValue,
        averageDurationMs: group.total ? group.durationMs / group.total : 0,
        totalDurationMs: group.durationMs,
        total: group.total,
      });
    });

    const series = Array.from(bySession.values())
      .sort(compareSessionOrder)
      .map((item) => ({
        date: item.date,
        dateKey: item.dateKey,
        fileName: item.fileName,
        sessionIndex: item.sessionIndex,
        sessionLabel: item.sessionLabel,
        values: item.values.sort(compareDifficultySort),
      }));

    const maxIndex = series.length - 1;
    return series.map((item, index) => ({
      ...item,
      opacity:
        maxIndex > 0 ? Number((0.3 + (index / maxIndex) * 0.7).toFixed(3)) : 1,
    }));
  }

  function formatDateKey(date) {
    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    const parts = easternDateKeyFormatter.formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatSessionDateLabel(dateKey) {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return "Unknown date";
    }

    const date = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
    );
    return sessionDateLabelFormatter.format(date);
  }

  function compareSessionOrder(a, b) {
    const aIndex = normalizeSessionIndex(a?.sessionIndex);
    const bIndex = normalizeSessionIndex(b?.sessionIndex);
    if (aIndex !== bIndex) {
      if (!aIndex) return 1;
      if (!bIndex) return -1;
      return aIndex - bIndex;
    }

    const dateDifference =
      (a?.date?.getTime?.() || 0) - (b?.date?.getTime?.() || 0);
    if (dateDifference !== 0) {
      return dateDifference;
    }

    return String(a?.fileName || "").localeCompare(String(b?.fileName || ""));
  }

  function getSessionAxisItems(points) {
    const sessions = new Map();
    points.forEach((point) => {
      const sessionIndex = normalizeSessionIndex(point.sessionIndex);
      if (!sessionIndex || sessions.has(sessionIndex)) {
        return;
      }

      sessions.set(sessionIndex, {
        sessionIndex,
        sessionLabel: normalizeSessionLabel(point.sessionLabel, sessionIndex),
        dateKey: point.dateKey,
        date: point.date,
        fileName: point.fileName,
      });
    });

    return Array.from(sessions.values()).sort(compareSessionOrder);
  }

  function renderSessionAxis(svg, x, sessionItems, yPosition) {
    const itemByIndex = new Map(
      sessionItems.map((item) => [item.sessionIndex, item]),
    );
    const axis = svg
      .append("g")
      .attr("class", "axis session-axis")
      .attr("transform", `translate(0,${yPosition})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(sessionItems.map((item) => item.sessionIndex))
          .tickFormat(() => ""),
      );

    axis.selectAll(".tick text").each(function (sessionIndex) {
      const item = itemByIndex.get(sessionIndex);
      if (!item) return;

      const text = d3.select(this).text("");
      text
        .append("tspan")
        .attr("class", "session-tick-label")
        .attr("x", 0)
        .attr("dy", "0.15em")
        .text(item.sessionLabel);
      text
        .append("tspan")
        .attr("class", "session-tick-date")
        .attr("x", 0)
        .attr("dy", "1.45em")
        .text(formatSessionDateLabel(item.dateKey));
    });

    return axis;
  }

  function formatSessionDescription(item) {
    return `${item.sessionLabel} (${formatSessionDateLabel(item.dateKey)}, Eastern Time)`;
  }

  function getSessionIdentity(item) {
    return String(item?.fileName || item?.sessionIndex || item?.dateKey || "");
  }

  function renderDifficultyChart(container, points) {
    container.innerHTML = "";

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 320;
    const margin = { top: 24, right: 26, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("class", "chart")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Accuracy by difficulty level");

    const x = d3
      .scalePoint()
      .domain(points.map((point) => point.level))
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3
      .scaleLinear()
      .domain([0, 100])
      .range([margin.top + innerHeight, margin.top]);

    svg
      .append("g")
      .attr("class", "grid-lines")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${margin.top + innerHeight})`)
      .call(d3.axisBottom(x));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((value) => `${value}%`),
      );

    if (points.length > 1) {
      svg
        .append("path")
        .datum(points)
        .attr("class", "line-path")
        .attr(
          "d",
          d3
            .line()
            .x((point) => x(point.level))
            .y((point) => y(point.accuracy)),
        );
    }

    const point = svg
      .selectAll(".chart-point")
      .data(points)
      .enter()
      .append("g")
      .attr("class", "chart-point");
    point
      .append("circle")
      .attr("cx", (item) => x(item.level))
      .attr("cy", (item) => y(item.accuracy))
      .attr("r", 5);
    point
      .append("title")
      .text(
        (item) =>
          `Level ${item.level}: ${formatPercent(item.accuracy)} (${item.correct}/${item.total})`,
      );

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("x", margin.left + innerWidth / 2)
      .attr("y", height - 12)
      .attr("text-anchor", "middle")
      .text("Difficulty Level");

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + innerHeight / 2))
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .text("Accuracy");
  }

  function renderUserTrendChart(container, series) {
    container.innerHTML = "";

    const visibleSeries = series
      .filter((item) => state.users.visibleTasks[item.task])
      .map((item) => ({
        ...item,
        values: item.values.filter((point) =>
          normalizeSessionIndex(point.sessionIndex),
        ),
      }))
      .filter((item) => item.values.length);
    const points = visibleSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement("p");
      empty.className = "message info";
      empty.textContent =
        "Select at least one task with available data to show the chart.";
      container.appendChild(empty);
      return;
    }

    const sessionItems = getSessionAxisItems(points);
    const margin = { top: 24, right: 34, bottom: 84, left: 64 };
    const width = Math.max(
      container.clientWidth || 760,
      sessionItems.length * 86 + margin.left + margin.right,
      360,
    );
    const height = 320;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("class", "chart")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("width", `${width}px`)
      .style("max-width", "none")
      .attr("role", "img")
      .attr(
        "aria-label",
        "User accuracy across sessions by task; session dates are shown in Eastern Time",
      );

    const x = d3
      .scalePoint()
      .domain(sessionItems.map((item) => item.sessionIndex))
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3
      .scaleLinear()
      .domain([0, 100])
      .range([margin.top + innerHeight, margin.top]);

    svg
      .append("g")
      .attr("class", "grid-lines")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    renderSessionAxis(svg, x, sessionItems, margin.top + innerHeight);

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((value) => `${value}%`),
      );

    visibleSeries.forEach((item) => {
      if (item.values.length > 1) {
        svg
          .append("path")
          .datum(item.values)
          .attr("class", "task-line")
          .attr("stroke", item.color)
          .attr(
            "d",
            d3
              .line()
              .x((point) => x(point.sessionIndex))
              .y((point) => y(point.accuracy)),
          );
      }

      const point = svg
        .selectAll(`.trend-point-${item.task}`)
        .data(item.values)
        .enter()
        .append("g")
        .attr("class", `trend-point trend-point-${item.task}`);

      point
        .append("circle")
        .attr("cx", (value) => x(value.sessionIndex))
        .attr("cy", (value) => y(value.accuracy))
        .attr("r", 5)
        .attr("fill", item.color);
      point
        .append("title")
        .text(
          (value) =>
            `${item.task} ${formatSessionDescription(value)}: ${formatPercent(value.accuracy)} (${value.correct}/${value.total})`,
        );
    });

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("x", margin.left + innerWidth / 2)
      .attr("y", height - 12)
      .attr("text-anchor", "middle")
      .text("Session (Eastern Time)");

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + innerHeight / 2))
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .text("Accuracy");
  }

  function renderUserDurationTrendChart(container, series) {
    container.innerHTML = "";

    const visibleSeries = series
      .filter((item) => state.users.visibleTasks[item.task])
      .map((item) => ({
        ...item,
        values: item.values.filter((point) =>
          normalizeSessionIndex(point.sessionIndex),
        ),
      }))
      .filter((item) => item.values.length);
    const points = visibleSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement("p");
      empty.className = "message info";
      empty.textContent =
        "Select at least one task with available duration data to show the chart.";
      container.appendChild(empty);
      return;
    }

    const sessionItems = getSessionAxisItems(points);
    const margin = { top: 24, right: 34, bottom: 84, left: 72 };
    const width = Math.max(
      container.clientWidth || 760,
      sessionItems.length * 86 + margin.left + margin.right,
      360,
    );
    const height = 320;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const maxDuration = d3.max(points, (point) => point.durationMs) || 1000;
    const svg = d3
      .select(container)
      .append("svg")
      .attr("class", "chart")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("width", `${width}px`)
      .style("max-width", "none")
      .attr("role", "img")
      .attr(
        "aria-label",
        "User duration across sessions by task; session dates are shown in Eastern Time",
      );

    const x = d3
      .scalePoint()
      .domain(sessionItems.map((item) => item.sessionIndex))
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3
      .scaleLinear()
      .domain([0, maxDuration * 1.12])
      .nice()
      .range([margin.top + innerHeight, margin.top]);

    svg
      .append("g")
      .attr("class", "grid-lines")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    renderSessionAxis(svg, x, sessionItems, margin.top + innerHeight);

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(formatDurationTick));

    visibleSeries.forEach((item) => {
      if (item.values.length > 1) {
        svg
          .append("path")
          .datum(item.values)
          .attr("class", "task-line")
          .attr("stroke", item.color)
          .attr(
            "d",
            d3
              .line()
              .x((point) => x(point.sessionIndex))
              .y((point) => y(point.durationMs)),
          );
      }

      const point = svg
        .selectAll(`.duration-trend-point-${item.task}`)
        .data(item.values)
        .enter()
        .append("g")
        .attr(
          "class",
          `duration-trend-point duration-trend-point-${item.task}`,
        );

      point
        .append("circle")
        .attr("cx", (value) => x(value.sessionIndex))
        .attr("cy", (value) => y(value.durationMs))
        .attr("r", 5)
        .attr("fill", item.color);
      point
        .append("title")
        .text(
          (value) =>
            `${item.task} ${formatSessionDescription(value)}: ${formatDurationCell(value.durationMs)} (${formatDurationCell(value.trainingMs)} training + ${formatDurationCell(value.restingMs)} resting)`,
        );
    });

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("x", margin.left + innerWidth / 2)
      .attr("y", height - 12)
      .attr("text-anchor", "middle")
      .text("Session (Eastern Time)");

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + innerHeight / 2))
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .text("Duration");
  }

  function renderUserDifficultyTrendChart(container, dateSeries, task) {
    container.innerHTML = "";

    const color = TASK_COLORS[task] || "#0b6b61";
    const points = dateSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement("p");
      empty.className = "message info";
      empty.textContent = `No ${task} response rows with difficulty levels were found for this user.`;
      container.appendChild(empty);
      return;
    }

    const levels = Array.from(
      points
        .reduce((levelMap, point) => {
          if (!levelMap.has(point.level)) {
            levelMap.set(point.level, {
              level: point.level,
              sortValue: point.sortValue,
            });
          }

          return levelMap;
        }, new Map())
        .values(),
    )
      .sort(compareDifficultySort)
      .map((point) => point.level);

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 320;
    const margin = { top: 24, right: 34, bottom: 56, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("class", "chart")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr(
        "aria-label",
        `${task} accuracy by difficulty level across sessions`,
      );

    const x = d3
      .scalePoint()
      .domain(levels)
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3
      .scaleLinear()
      .domain([0, 100])
      .range([margin.top + innerHeight, margin.top]);

    svg
      .append("g")
      .attr("class", "grid-lines")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${margin.top + innerHeight})`)
      .call(d3.axisBottom(x));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((value) => `${value}%`),
      );

    function highlightSession(sessionKey) {
      const hasHighlight = Boolean(sessionKey);
      svg
        .selectAll(".difficulty-date-series")
        .attr("display", (item) =>
          !hasHighlight || getSessionIdentity(item) === sessionKey
            ? null
            : "none",
        );
      d3.select(container)
        .selectAll(".date-legend-item")
        .classed(
          "muted",
          (item) => hasHighlight && getSessionIdentity(item) !== sessionKey,
        );
    }

    dateSeries.forEach((item) => {
      const dateGroup = svg
        .append("g")
        .datum(item)
        .attr("class", "difficulty-date-series");

      if (item.values.length > 1) {
        const path = dateGroup
          .append("path")
          .datum(item.values)
          .attr("class", "difficulty-date-line")
          .attr("stroke", color)
          .attr("stroke-opacity", item.opacity)
          .attr(
            "d",
            d3
              .line()
              .x((point) => x(point.level))
              .y((point) => y(point.accuracy)),
          );

        path
          .append("title")
          .text(
            `${formatSessionDescription(item)}: ${task} accuracy by difficulty`,
          );
      }

      const point = dateGroup
        .selectAll("g")
        .data(item.values)
        .enter()
        .append("g")
        .attr("class", "difficulty-trend-point");

      point
        .append("circle")
        .attr("cx", (value) => x(value.level))
        .attr("cy", (value) => y(value.accuracy))
        .attr("r", 5)
        .attr("fill", color)
        .attr("fill-opacity", item.opacity);
      point
        .append("title")
        .text(
          (value) =>
            `${task} ${formatSessionDescription(item)} level ${value.level}: ${formatPercent(value.accuracy)} (${value.correct}/${value.total})`,
        );
    });

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("x", margin.left + innerWidth / 2)
      .attr("y", height - 12)
      .attr("text-anchor", "middle")
      .text("Difficulty Level");

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + innerHeight / 2))
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .text("Accuracy");

    const legend = d3
      .select(container)
      .append("div")
      .attr("class", "date-legend");
    const legendItem = legend
      .selectAll(".date-legend-item")
      .data(dateSeries)
      .enter()
      .append("span")
      .attr("class", "date-legend-item")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        (item) => `Show only ${formatSessionDescription(item)}`,
      )
      .on("mouseenter focus", (event, item) =>
        highlightSession(getSessionIdentity(item)),
      )
      .on("mouseleave blur", () => highlightSession(""));
    legendItem
      .append("span")
      .attr("class", "date-legend-swatch")
      .style("background", color)
      .style("opacity", (item) => item.opacity);
    legendItem
      .append("span")
      .text(
        (item) =>
          `${item.sessionLabel} · ${formatSessionDateLabel(item.dateKey)} ET`,
      );
  }

  function renderUserDurationDifficultyTrendChart(container, dateSeries, task) {
    container.innerHTML = "";

    const color = TASK_COLORS[task] || "#0b6b61";
    const points = dateSeries.flatMap((item) => item.values);
    if (!points.length) {
      const empty = document.createElement("p");
      empty.className = "message info";
      empty.textContent = `No ${task} duration rows with difficulty levels were found for this user.`;
      container.appendChild(empty);
      return;
    }

    const levels = Array.from(
      points
        .reduce((levelMap, point) => {
          if (!levelMap.has(point.level)) {
            levelMap.set(point.level, {
              level: point.level,
              sortValue: point.sortValue,
            });
          }

          return levelMap;
        }, new Map())
        .values(),
    )
      .sort(compareDifficultySort)
      .map((point) => point.level);

    const width = Math.max(container.clientWidth || 760, 360);
    const height = 320;
    const margin = { top: 24, right: 34, bottom: 56, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxDuration =
      d3.max(points, (point) => point.averageDurationMs) || 1000;

    const svg = d3
      .select(container)
      .append("svg")
      .attr("class", "chart")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr(
        "aria-label",
        `${task} average duration by difficulty level across sessions`,
      );

    const x = d3
      .scalePoint()
      .domain(levels)
      .range([margin.left, margin.left + innerWidth])
      .padding(0.45);
    const y = d3
      .scaleLinear()
      .domain([0, maxDuration * 1.12])
      .nice()
      .range([margin.top + innerHeight, margin.top]);

    svg
      .append("g")
      .attr("class", "grid-lines")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${margin.top + innerHeight})`)
      .call(d3.axisBottom(x));

    svg
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(formatDurationTick));

    function highlightSession(sessionKey) {
      const hasHighlight = Boolean(sessionKey);
      svg
        .selectAll(".duration-date-series")
        .attr("display", (item) =>
          !hasHighlight || getSessionIdentity(item) === sessionKey
            ? null
            : "none",
        );
      d3.select(container)
        .selectAll(".date-legend-item")
        .classed(
          "muted",
          (item) => hasHighlight && getSessionIdentity(item) !== sessionKey,
        );
    }

    dateSeries.forEach((item) => {
      const dateGroup = svg
        .append("g")
        .datum(item)
        .attr("class", "duration-date-series");

      if (item.values.length > 1) {
        const path = dateGroup
          .append("path")
          .datum(item.values)
          .attr("class", "duration-date-line")
          .attr("stroke", color)
          .attr("stroke-opacity", item.opacity)
          .attr(
            "d",
            d3
              .line()
              .x((point) => x(point.level))
              .y((point) => y(point.averageDurationMs)),
          );

        path
          .append("title")
          .text(
            `${formatSessionDescription(item)}: ${task} average trial duration by difficulty`,
          );
      }

      const point = dateGroup
        .selectAll("g")
        .data(item.values)
        .enter()
        .append("g")
        .attr("class", "duration-trend-point");

      point
        .append("circle")
        .attr("cx", (value) => x(value.level))
        .attr("cy", (value) => y(value.averageDurationMs))
        .attr("r", 5)
        .attr("fill", color)
        .attr("fill-opacity", item.opacity);
      point
        .append("title")
        .text(
          (value) =>
            `${task} ${formatSessionDescription(item)} level ${value.level}: ${formatDurationCell(value.averageDurationMs)} avg (${value.total} trials, ${formatDurationCell(value.totalDurationMs)} total)`,
        );
    });

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("x", margin.left + innerWidth / 2)
      .attr("y", height - 12)
      .attr("text-anchor", "middle")
      .text("Difficulty Level");

    svg
      .append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -(margin.top + innerHeight / 2))
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .text("Avg Trial Time");

    const legend = d3
      .select(container)
      .append("div")
      .attr("class", "date-legend");
    const legendItem = legend
      .selectAll(".date-legend-item")
      .data(dateSeries)
      .enter()
      .append("span")
      .attr("class", "date-legend-item")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        (item) => `Show only ${formatSessionDescription(item)}`,
      )
      .on("mouseenter focus", (event, item) =>
        highlightSession(getSessionIdentity(item)),
      )
      .on("mouseleave blur", () => highlightSession(""));
    legendItem
      .append("span")
      .attr("class", "date-legend-swatch")
      .style("background", color)
      .style("opacity", (item) => item.opacity);
    legendItem
      .append("span")
      .text(
        (item) =>
          `${item.sessionLabel} · ${formatSessionDateLabel(item.dateKey)} ET`,
      );
  }
}
