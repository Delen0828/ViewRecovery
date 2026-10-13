import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  CheckboxGroup,
  Checkbox,
  Select,
  SelectItem,
  Switch,
  Tooltip,
} from "@heroui/react";
import { Pin, PinOff, ArrowUpRight } from "lucide-react";
import { Panel, Stats, Notice, api } from "./ui.jsx";
import { renderPortalChart, TASK_COLORS } from "./charts.js";

export function Chart({ data, userId, type, visibleTasks, task, metrics }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    let width = 0;
    const render = () => {
      renderPortalChart(node, {
        data,
        userId,
        type,
        visibleTasks,
        task,
        metrics,
      });
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
      node.replaceChildren();
    };
  }, [data, userId, type, visibleTasks, task, metrics]);
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
    (data?.accuracy_series || [])
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
  const [visible, setVisible] = useState(Object.keys(TASK_COLORS)),
    [advanced, setAdvanced] = useState(false),
    [error, setError] = useState(""),
    [pinBusy, setPinBusy] = useState(false);
  const available = Object.keys(TASK_COLORS).filter((task) =>
    (data?.difficulty_series || []).some(
      (point) => point.userId === userId && point.task === task,
    ),
  );
  const [difficultyTask, setDifficultyTask] = useState(
    available[0] || "Motion",
  );
  const task = available.includes(difficultyTask)
    ? difficultyTask
    : available[0] || "Motion";
  const pinned = preferences?.dashboard_charts || ["accuracy", "duration"];
  const types = dashboard
    ? pinned
    : [
        "accuracy",
        "duration",
        ...(admin && advanced ? ["difficulty", "difficulty-duration"] : []),
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
  const visibleTasks = Object.fromEntries(
    Object.keys(TASK_COLORS).map((name) => [name, visible.includes(name)]),
  );
  return (
    <div className="progress-content">
      {!dashboard && <Stats summary={summary} />}
      <Notice error>{error}</Notice>
      <div className="chart-toolbar">
        <div>
          <h2>
            {dashboard ? "Progress at a glance" : "Session visualizations"}
          </h2>
          <TaskControls
            data={data}
            userId={userId}
            visible={visible}
            onChange={setVisible}
          />
        </div>
        {dashboard ? (
          <Button
            variant="light"
            size="sm"
            endContent={<ArrowUpRight size={15} />}
            onPress={onProgress}
          >
            View progress
          </Button>
        ) : admin ? (
          <Switch size="sm" isSelected={advanced} onValueChange={setAdvanced}>
            Advanced charts
          </Switch>
        ) : (
          <span className="muted pin-hint">Pin charts to your dashboard.</span>
        )}
      </div>
      {admin && advanced && (
        <div className="difficulty-controls">
          <Select
            label="Difficulty task"
            aria-label="Difficulty task"
            size="sm"
            selectedKeys={[task]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setDifficultyTask(next);
            }}
            variant="bordered"
          >
            {(available.length ? available : ["Motion", "Centrality"]).map(
              (name) => (
                <SelectItem key={name}>{name}</SelectItem>
              ),
            )}
          </Select>
          <span className="muted">
            Hover a session in the legend to compare it. Newer sessions appear
            darker.
          </span>
        </div>
      )}
      {types.length ? (
        <div className="charts-grid">
          {types.map((type) => (
            <Panel
              key={type}
              title={CHART_TITLES[type]}
              subtitle={
                type.includes("difficulty")
                  ? `${task} · compare sessions by level`
                  : "By task · session dates in Eastern Time"
              }
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
            >
              <Chart
                data={data}
                userId={userId}
                type={type}
                visibleTasks={visibleTasks}
                task={task}
              />
            </Panel>
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
