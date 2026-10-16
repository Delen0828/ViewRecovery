import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  CheckboxGroup,
  Checkbox,
  Select,
  SelectItem,
  Tooltip,
} from "@heroui/react";
import { Pin, PinOff, ArrowUpRight } from "lucide-react";
import { Panel, Stats, Notice, api } from "./ui.jsx";
import { renderPortalChart, TASK_COLORS } from "./charts.js";

const NO_HIDDEN_SESSIONS = [];

export function Chart({ data, userId, type, visibleTasks, task, metrics, hiddenSessions = NO_HIDDEN_SESSIONS, onSessionToggle }) {
  const ref = useRef(null);
  const focusedLabel = useRef(null);
  useEffect(() => {
    const node = ref.current;
    let width = 0;
    const render = () => {
      const activeLabel = node.contains(document.activeElement)
        ? document.activeElement.getAttribute("aria-label") : focusedLabel.current;
      focusedLabel.current = null;
      renderPortalChart(node, {
        data,
        userId,
        type,
        visibleTasks,
        task,
        metrics,
        hiddenSessions,
        onSessionToggle,
      });
      if (activeLabel) {
        [...node.querySelectorAll(".date-legend input")]
          .find((input) => input.getAttribute("aria-label") === activeLabel)?.focus();
      }
      // Keep the original point details available to mouse and keyboard users.
      node
        .querySelectorAll(
          "g.trend-point,g.duration-trend-point,g.difficulty-trend-point,g.chart-point",
        )
        .forEach((point) => {
          const title = point.querySelector("title");
          if (title) {
            point.setAttribute("tabindex", "0");
            point.setAttribute("aria-label", title.textContent);
          }
        });
    };
    render();
    const observer = new ResizeObserver(() => {
      if (Math.abs(node.clientWidth - width) > 1) {
        width = node.clientWidth;
        render();
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      focusedLabel.current = node.contains(document.activeElement)
        ? document.activeElement.getAttribute("aria-label") : null;
      node.replaceChildren();
    };
  }, [data, userId, type, visibleTasks, task, metrics, hiddenSessions, onSessionToggle]);
  return <div ref={ref} className={`chart-wrap chart-${type}`} />;
}
export const CHART_TITLES = {
  accuracy: "Accuracy across sessions",
  duration: "Duration across sessions",
  difficulty: "Accuracy by difficulty",
  "difficulty-duration": "Duration by difficulty",
};
export function TaskControls({ data, userId, visible, onChange }) {
  const available = new Set(
    [...(data?.accuracy_series || []), ...(data?.duration_series || [])]
      .filter((point) => point.userId === userId)
      .map((point) => point.task),
  );
  const tasks = Object.keys(TASK_COLORS).filter(
    (task) => available.has(task) || ["Motion", "Centrality"].includes(task),
  );
  return (
    <CheckboxGroup
      aria-label="Visible tasks"
      orientation="horizontal"
      value={visible}
      onValueChange={onChange}
      className="task-controls"
    >
      {tasks.map((task) => (
        <Checkbox value={task} key={task} size="sm">
          <span className="task-label">
            <i style={{ background: TASK_COLORS[task] }} />
            {task}
          </span>
        </Checkbox>
      ))}
    </CheckboxGroup>
  );
}

function Visualization({ data, userId, type, actions }) {
  const [visible, setVisible] = useState(Object.keys(TASK_COLORS));
  const [difficultyTask, setDifficultyTask] = useState("Motion");
  const [hiddenByTask, setHiddenByTask] = useState({});
  const available = Object.keys(TASK_COLORS).filter((name) =>
    (data?.difficulty_series || []).some((point) => point.userId === userId && point.task === name),
  );
  const task = available.includes(difficultyTask) ? difficultyTask : available[0] || "Motion";
  const toggleSession = useCallback((key, checked) => {
    setHiddenByTask((current) => ({
      ...current,
      [task]: checked
        ? (current[task] || []).filter((item) => item !== key)
        : [...(current[task] || []), key],
    }));
  }, [task]);
  const difficulty = type.includes("difficulty");
  return (
    <Panel
      title={CHART_TITLES[type]}
      actions={actions}
      className={`chart-panel-${type}`}
    >
      <div className="chart-configuration" role="group" aria-label={`${CHART_TITLES[type]} configuration`}>
        {difficulty ? (
          <>
            <Select
              label="Task"
              aria-label={`${CHART_TITLES[type]} task`}
              size="sm"
              selectedKeys={[task]}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) setDifficultyTask(next);
              }}
              variant="bordered"
              className="difficulty-task-select"
            >
              {(available.length ? available : ["Motion", "Centrality"]).map((name) => (
                <SelectItem key={name}>{name}</SelectItem>
              ))}
            </Select>
            <p className="muted chart-filter-hint">Later sessions appear darker.</p>
          </>
        ) : (
          <TaskControls data={data} userId={userId} visible={visible} onChange={setVisible} />
        )}
      </div>
      <Chart
        data={data}
        userId={userId}
        type={type}
        visibleTasks={Object.fromEntries(Object.keys(TASK_COLORS).map((name) => [name, visible.includes(name)]))}
        task={task}
        hiddenSessions={hiddenByTask[task] || NO_HIDDEN_SESSIONS}
        onSessionToggle={toggleSession}
      />
    </Panel>
  );
}

export function ProgressCharts({
  data,
  userId,
  admin = false,
  preferences,
  onPreferences,
  summary,
  dashboard = false,
  onProgress,
}) {
  const [error, setError] = useState(""),
    [pinBusy, setPinBusy] = useState(false);
  const pinned = preferences?.dashboard_charts || ["accuracy", "duration"];
  const types = dashboard
    ? pinned
    : [
        "accuracy",
        "duration",
        ...(admin ? ["difficulty", "difficulty-duration"] : []),
      ];
  const togglePin = async (type) => {
    setError("");
    setPinBusy(true);
    try {
      const result = await api("/data-portal/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          dashboard_charts: pinned.includes(type)
            ? pinned.filter((item) => item !== type)
            : [...pinned, type],
        }),
      });
      onPreferences(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setPinBusy(false);
    }
  };
  return (
    <div className="progress-content">
      {!dashboard && <Stats summary={summary} preferences={preferences} onPreferences={onPreferences} />}
      <Notice error>{error}</Notice>
      <div className="chart-toolbar">
        <div>
          <h2>
            {dashboard ? "Progress at a glance" : "Session visualizations"}
          </h2>
        </div>
        {dashboard && (
          <Button
            variant="light"
            size="sm"
            endContent={<ArrowUpRight size={15} />}
            onPress={onProgress}
          >
            View progress
          </Button>
        )}
      </div>
      {types.length ? (
        <div className="charts-grid">
          {types.map((type) => (
            <Visualization
              key={type}
              data={data}
              userId={userId}
              type={type}
              actions={
                !admin &&
                !dashboard && (
                  <Tooltip
                    content={
                      pinned.includes(type)
                        ? "Unpin from dashboard"
                        : "Pin to dashboard"
                    }
                  >
                    <Button
                      isIconOnly
                      size="sm"
                      variant={pinned.includes(type) ? "flat" : "light"}
                      color={pinned.includes(type) ? "primary" : "default"}
                      aria-label={`${pinned.includes(type) ? "Unpin" : "Pin"} ${CHART_TITLES[type]}`}
                      onPress={() => togglePin(type)}
                      isDisabled={pinBusy}
                    >
                      {pinned.includes(type) ? (
                        <Pin size={16} />
                      ) : (
                        <PinOff size={16} />
                      )}
                    </Button>
                  </Tooltip>
                )
              }
            />
          ))}
        </div>
      ) : (
        <Panel>
          <p className="muted">
            Choose charts in My Progress to show them here.
          </p>
          <Button size="sm" variant="light" onPress={onProgress}>
            Choose charts
          </Button>
        </Panel>
      )}
    </div>
  );
}
