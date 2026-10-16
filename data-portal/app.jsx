import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  HeroUIProvider,
  Tabs,
  Tab,
  Button,
  Input,
  Select,
  SelectItem,
  Avatar,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/react";
import { LogOut, Search, Plus, ArrowUpRight } from "lucide-react";
import {
  Brand,
  Panel,
  PageTitle,
  Empty,
  Notice,
  Stats,
  RefreshButton,
  api,
} from "./ui.jsx";
import { DashboardCalendar, NextSession } from "./schedule.jsx";
import ScheduleEditor from "./schedule.jsx";
import ScheduleGantt from "./schedule-gantt.jsx";
import { ProgressCharts } from "./progress.jsx";
import StudySetup from "./study-setup.jsx";
import ManageUser, { AddUserModal } from "./accounts.jsx";
import Files, { SessionPreview } from "./files.jsx";
import "./styles.css";

const USER_TABS = [
  ["dashboard", "Dashboard"],
  ["setup", "Study Setup"],
  ["progress", "My Progress"],
];
const ADMIN_TABS = [
  ["schedule", "Schedule"],
  ["accounts", "Manage Users"],
  ["analytics", "Data Analytics"],
  ["downloads", "File Download"],
];
function initialTab(role) {
  const params = new URLSearchParams(location.search),
    value = params.get("tab");
  const tabs = role === "admin" ? ADMIN_TABS : USER_TABS;
  if (tabs.some(([id]) => id === value)) return value;
  if (location.pathname.endsWith("/users.html"))
    return role === "admin" ? "analytics" : "progress";
  if (
    params.get("view") === "files" ||
    location.pathname.endsWith("/preview.html")
  )
    return role === "admin" ? "downloads" : "progress";
  return tabs[0][0];
}
function Login({ onSignedIn, sessionError }) {
  const [signup, setSignup] = useState(false),
    [mode, setMode] = useState("user"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [email, setEmail] = useState(""),
    [invitation, setInvitation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(sessionError || "");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        signup
          ? "/data-portal/auth/sign-up/email"
          : "/data-portal/auth/sign-in/username",
        {
          method: "POST",
          body: JSON.stringify(
            signup
              ? {
                  username,
                  password,
                  email,
                  invitationCode: invitation,
                  name: `User ${username}`,
                }
              : { username, password, mode },
          ),
        },
      );
      await onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <header>
        <Brand />
      </header>
      <div className="login-layout">
        <Panel className="login-card">
          <h2>{signup ? "Create user account" : "Data Portal"}</h2>
          <p className="muted">
            {signup
              ? "Use your study team’s invitation code."
              : "Welcome back"}
          </p>
          <form onSubmit={submit} className="login-form">
            <Notice error>{error}</Notice>
            {!signup && (
              <Select
                label="Login mode"
                labelPlacement="outside"
                selectedKeys={[mode]}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (next) setMode(next);
                }}
                variant="bordered"
              >
                <SelectItem key="user">User</SelectItem>
                <SelectItem key="admin">Admin</SelectItem>
              </Select>
            )}
            <Input
              id="username"
              label={signup || mode === "user" ? "User ID" : "Admin username"}
              labelPlacement="outside"
              value={username}
              onValueChange={setUsername}
              autoComplete="username"
              isRequired
              variant="bordered"
            />
            {signup && (
              <Input
                type="email"
                label="Email"
                labelPlacement="outside"
                value={email}
                onValueChange={setEmail}
                autoComplete="email"
                isRequired
                variant="bordered"
              />
            )}
            <Input
              id="password"
              type="password"
              label="Password"
              labelPlacement="outside"
              value={password}
              onValueChange={setPassword}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              maxLength={128}
              isRequired
              variant="bordered"
            />
            {signup && (
              <Input
                label="Invitation code"
                labelPlacement="outside"
                value={invitation}
                onValueChange={setInvitation}
                isRequired
                variant="bordered"
              />
            )}
            <Button
              type="submit"
              color="primary"
              isLoading={busy}
              endContent={<ArrowUpRight size={16} />}
              fullWidth
            >
              {signup ? "Create Account" : "Sign In"}
            </Button>
            <Button
              variant="light"
              onPress={() => {
                setSignup(!signup);
                setError("");
              }}
              isDisabled={busy}
            >
              {signup ? "Back to Sign In" : "Create User Account"}
            </Button>
          </form>
        </Panel>
      </div>
      <footer>
        Copyright 2026. Developed by Songwen Hu, powering BRIGHT in VPP lab
      </footer>
    </div>
  );
}
function UserList({ users, data, selected, onSelect, onAdd }) {
  const [search, setSearch] = useState("");
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const revealSelected = () => {
      const active = list.querySelector('[aria-pressed="true"]');
      if (!active) return;
      const bounds = list.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const top = item.top < bounds.top ? item.top - bounds.top
        : item.bottom > bounds.bottom ? item.bottom - bounds.bottom : 0;
      const left = item.left < bounds.left ? item.left - bounds.left
        : item.right > bounds.right ? item.right - bounds.right : 0;
      list.scrollBy({ top, left });
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selected]);
  const shown = users.filter((user) =>
    user.user_id.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Panel className="user-sidebar">
      <div className="sidebar-heading">
        <h2>
          Users <span>{users.length}</span>
        </h2>
        <Button
          isIconOnly
          size="sm"
          variant="flat"
          color="primary"
          aria-label="Add user"
          onPress={onAdd}
        >
          <Plus size={17} />
        </Button>
      </div>
      <Input
        aria-label="Search users"
        placeholder="Search users"
        size="sm"
        value={search}
        onValueChange={setSearch}
        startContent={<Search size={15} />}
        variant="bordered"
        isClearable
      />
      <div className="user-list" aria-label="User list" ref={listRef}>
        {shown.length ? (
          shown.map((user) => {
            const summary = data?.user_summaries?.find(
              (item) => item.id === user.user_id,
            );
            return (
              <Button
                key={user.user_id}
                variant="light"
                className={`user-button ${selected === user.user_id ? "active" : ""}`}
                onPress={() => onSelect(user.user_id)}
                aria-pressed={selected === user.user_id}
              >
                <Avatar
                  name={user.user_id.slice(0, 2)}
                  size="sm"
                  className="user-avatar"
                />
                <span className="user-copy">
                  <strong>{user.user_id}</strong>
                  <small>
                    {user.has_account === false
                      ? "Data only"
                      : `${summary?.sessions || 0} sessions · ${summary?.trials || 0} trials`}
                  </small>
                </span>
                {selected === user.user_id && <i />}
              </Button>
            );
          })
        ) : (
          <p className="muted sidebar-empty">
            {users.length ? "No users match." : "Add a user to get started."}
          </p>
        )}
      </div>
    </Panel>
  );
}
function Portal() {
  const [dirty, setDirty] = useState(false),
    [pending, setPending] = useState(null);
  const [account, setAccount] = useState(null),
    [sessionLoading, setSessionLoading] = useState(true),
    [sessionError, setSessionError] = useState(""),
    [tab, setTab] = useState(""),
    [data, setData] = useState(null),
    [users, setUsers] = useState([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [preferences, setPreferences] = useState(null),
    [schedule, setSchedule] = useState(null),
    [allSessions, setAllSessions] = useState([]),
    [draftSchedule, setDraftSchedule] = useState(null),
    [scheduleTarget, setScheduleTarget] = useState(null),
    [detailError, setDetailError] = useState(""),
    [add, setAdd] = useState(false),
    [preview, setPreview] = useState(
      new URLSearchParams(location.search).get("file") || "",
    ),
    [logoutBusy, setLogoutBusy] = useState(false),
    [refreshKey, setRefreshKey] = useState(0);
  const loadSession = useCallback(async () => {
    try {
      const result = await api("/data-portal/api/session");
      setAccount(result.authenticated ? result : null);
      if (result.authenticated) {
        setTab(initialTab(result.role));
        setError("");
        setSessionError("");
      }
    } catch (err) {
      setSessionError(err.message);
    } finally {
      setSessionLoading(false);
    }
  }, []);
  useEffect(() => {
    loadSession();
    const expired = () => {
      setAccount(null);
      setData(null);
      setPreferences(null);
      setSchedule(null);
      setAllSessions([]);
      setSessionError("Your session expired. Sign in again.");
    };
    window.addEventListener("portal-session-expired", expired);
    return () => window.removeEventListener("portal-session-expired", expired);
  }, [loadSession]);
  const admin = account?.role === "admin";
  const refresh = useCallback(
    async (desired) => {
      if (!account) return;
      setLoading(true);
      setError("");
      const results = await Promise.allSettled([
        api("/data-portal/api/user-trends"),
        ...(admin ? [api("/data-portal/api/users")] : []),
        ...(admin ? [api("/data-portal/api/schedule/overview")] : []),
      ]);
      const errors = [];
      if (results[0].status === "fulfilled") setData(results[0].value);
      else errors.push(results[0].reason.message);
      if (admin) {
        if (results[1].status === "fulfilled") {
          const list = results[1].value.users;
          setUsers(list);
          setSelected((current) => {
            const next = typeof desired === "string" ? desired : current;
            return list.some((user) => user.user_id === next)
              ? next
              : list.find((user) => user.has_account)?.user_id ||
                  list[0]?.user_id ||
                  "";
          });
        } else errors.push(results[1].reason.message);
        if (results[2].status === "fulfilled") setAllSessions(results[2].value.sessions);
        else errors.push(results[2].reason.message);
      } else setSelected(account.user_id);
      setError(errors.join(" "));
      setLoading(false);
    },
    [account, admin],
  );
  useEffect(() => {
    if (!account) return;
    refresh();
    const interval = setInterval(() => refresh(), 60000);
    return () => clearInterval(interval);
  }, [refresh, account]);
  const selectedUser = users.find((user) => user.user_id === selected);
  const hasAccount = !admin || selectedUser?.has_account !== false;
  useEffect(() => {
    if (!account || !selected || !hasAccount) return;
    let alive = true;
    setPreferences(null);
    setSchedule(null);
    setDetailError("");
    const query = "?" + new URLSearchParams({ user_id: selected });
    Promise.allSettled([
      api("/data-portal/api/preferences" + query),
      api("/data-portal/api/schedule" + query),
    ]).then((results) => {
      if (!alive) return;
      const errors = [];
      if (results[0].status === "fulfilled") setPreferences(results[0].value);
      else errors.push(results[0].reason.message);
      if (results[1].status === "fulfilled") setSchedule(results[1].value);
      else errors.push(results[1].reason.message);
      setDetailError(errors.join(" "));
    });
    const interval = !admin
      ? setInterval(
          () =>
            api("/data-portal/api/schedule" + query)
              .then((result) => {
                if (alive) setSchedule(result);
              })
              .catch((err) => {
                if (alive) setDetailError(err.message);
              }),
          30000,
        )
      : null;
    return () => {
      alive = false;
      if (interval) clearInterval(interval);
    };
  }, [account, selected, admin, hasAccount, refreshKey]);
  const guard = (action) => {
    if (dirty) setPending(() => action);
    else action();
  };
  const selectScheduleSession = (row) => {
    const target = { userId: row.user_id, sessionId: row.session_id };
    if (row.user_id === selected) setScheduleTarget(target);
    else guard(() => {
      setDirty(false);
      setSelected(row.user_id);
      setScheduleTarget(target);
    });
  };
  useEffect(() => {
    if (!dirty) return;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const changeTab = (next) =>
    guard(() => {
      setDirty(false);
      setTab(next);
      const url = new URL(location.href);
      url.searchParams.set("tab", next);
      url.searchParams.delete("view");
      history.replaceState({}, "", url);
    });
  const logout = async () => {
    setLogoutBusy(true);
    setError("");
    try {
      await api("/data-portal/auth/sign-out", { method: "POST", body: "{}" });
      setAccount(null);
      setSelected("");
      setData(null);
      setUsers([]);
      setPreferences(null);
      setSchedule(null);
      setAllSessions([]);
      setPreview("");
      setSessionError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLogoutBusy(false);
    }
  };
  const summary = data?.user_summaries?.find((user) => user.id === selected);
  if (sessionLoading)
    return (
      <div className="initial-loading">
        <Spinner label="Loading data portal…" />
      </div>
    );
  if (!account)
    return (
      <Login
        key={sessionError}
        onSignedIn={loadSession}
        sessionError={sessionError}
      />
    );
  const tabs = admin ? ADMIN_TABS : USER_TABS;
  const title = tabs.find(([id]) => id === tab)?.[1] || tabs[0][1];
  const subtitle = {
    dashboard: "Your schedule and progress, all in one place.",
    setup: "Prepare your screen and stimulus settings.",
    progress: "Follow your progress across study sessions.",
    schedule: "Plan study sessions and breaks for each user.",
    accounts: "Manage participant accounts and access.",
    analytics: "Explore performance and compare sessions.",
    downloads: "Find and download recorded session data.",
  }[tab];
  let content;
  if (admin && !selected)
    content = (
      <Panel>
        <Empty
          title="Add your first user"
          action={
            <Button
              color="primary"
              startContent={<Plus size={16} />}
              onPress={() => setAdd(true)}
            >
              Add user
            </Button>
          }
        >
          Create an account to plan sessions and view their progress.
        </Empty>
      </Panel>
    );
  else if (admin && !hasAccount && tab === "schedule")
    content = (
      <Panel>
        <Empty
          title="This user has recorded data only"
          action={
            <Button color="primary" onPress={() => setAdd(true)}>
              Create account
            </Button>
          }
        >
          Add an account with the same user ID to manage access and schedules.
        </Empty>
      </Panel>
    );
  else if (tab === "dashboard")
    content =
      schedule && preferences ? (
        <div className="dashboard-layout">
          <DashboardCalendar sessions={schedule.sessions} />
          <div className="dashboard-main">
            <NextSession
              sessions={schedule.sessions}
              onProgress={() => changeTab("progress")}
            />
            <Stats summary={summary} preferences={preferences} onPreferences={setPreferences} />
            <ProgressCharts
              data={data}
              userId={selected}
              preferences={preferences}
              dashboard
              onProgress={() => changeTab("progress")}
            />
          </div>
        </div>
      ) : null;
  else if (tab === "setup")
    content = preferences ? (
      <StudySetup
        key={selected + refreshKey}
        preferences={preferences}
        onSaved={setPreferences}
        onDirtyChange={setDirty}
      />
    ) : null;
  else if (tab === "progress" || tab === "analytics")
    content = (
      <ProgressCharts
        key={selected + tab}
        data={data}
        userId={selected}
        admin={admin}
        preferences={preferences}
        onPreferences={setPreferences}
        summary={summary}
      />
    );
  else if (tab === "schedule")
    content =
      schedule && schedule.user_id === selected ? (
        <ScheduleEditor
          key={selected + refreshKey}
          schedule={schedule}
          sessionTarget={scheduleTarget?.userId === selected ? scheduleTarget : null}
          onSaved={(result) => {
            setSchedule(result);
            setAllSessions((current) => [
              ...current.filter((row) => row.user_id !== result.user_id),
              ...result.sessions,
            ]);
          }}
          onPreviewChange={setDraftSchedule}
          onDirtyChange={setDirty}
        />
      ) : null;
  else if (tab === "accounts")
    content = selectedUser ? (
      <ManageUser
        key={selected + refreshKey}
        user={selectedUser}
        summary={summary}
        onDirtyChange={setDirty}
        onSaved={async (id) => {
          await refresh(id);
        }}
        onDeleted={async () => {
          setDirty(false);
          setPreferences(null);
          setSchedule(null);
          await refresh("");
        }}
      />
    ) : null;
  else if (tab === "downloads")
    content = <Files key={selected} userId={selected} refreshKey={refreshKey} onPreview={setPreview} />;
  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <Brand />
        <nav aria-label="Portal panels">
          <Tabs
            aria-label="Portal panels"
            selectedKey={tab}
            onSelectionChange={changeTab}
            variant="light"
            radius="full"
            classNames={{
              tabList: "portal-tabs",
              tab: "portal-tab",
              cursor: "portal-tab-cursor",
              tabContent: "portal-tab-content",
            }}
          >
            {tabs.map(([id, label]) => (
              <Tab key={id} title={label} />
            ))}
          </Tabs>
        </nav>
        <div className="account-menu">
          <RefreshButton
            onPress={() =>
              guard(() => {
                setDirty(false);
                refresh();
                setRefreshKey((value) => value + 1);
              })
            }
            isLoading={loading}
          />
          <Avatar
            name={admin ? "AD" : account.user_id.slice(0, 2)}
            size="sm"
            className="account-avatar"
          />
          <span>
            {admin ? "Administrator" : account.user_id}
            <small>{admin ? "Admin" : "Participant"}</small>
          </span>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label="Log Out"
            onPress={() => guard(logout)}
            isLoading={logoutBusy}
          >
            <LogOut size={17} />
          </Button>
        </div>
      </header>
      <main className="portal-main">
        <PageTitle
          title={title}
          subtitle={subtitle}
        />
        <Notice error>{error}</Notice>
        {admin && tab === "schedule" && (
          <ScheduleGantt
            users={users}
            onSessionSelect={selectScheduleSession}
            sessions={draftSchedule ? [
              ...allSessions.filter((row) => row.user_id !== draftSchedule.user_id),
              ...draftSchedule.sessions,
            ] : allSessions}
          />
        )}
        <div className={admin ? `admin-layout ${tab === "schedule" ? "schedule-layout" : ""}` : "user-layout"}>
          {admin && (
            <UserList
              users={users}
              data={data}
              selected={selected}
              onSelect={(id) =>
                guard(() => {
                  setDirty(false);
                  setScheduleTarget(null);
                  setSelected(id);
                })
              }
              onAdd={() => guard(() => setAdd(true))}
            />
          )}
          <section
            className="workspace-panel"
            aria-label={`${title} workspace`}
          >
            <Notice error>{detailError}</Notice>
            {content ||
              (!detailError && (
                <div className="panel-loading">
                  <Spinner label="Loading workspace…" />
                </div>
              ))}
          </section>
        </div>
      </main>
      <footer className="portal-footer">
        Copyright 2026. Developed by Songwen Hu, powering BRIGHT in VPP lab
      </footer>
      <Modal isOpen={!!pending} onClose={() => setPending(null)}>
        <ModalContent>
          <ModalHeader>Discard unsaved changes?</ModalHeader>
          <ModalBody>
            <p>You have changes that haven’t been saved.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              color="primary"
              onPress={() => {
                const action = pending;
                setPending(null);
                setDirty(false);
                setRefreshKey((value) => value + 1);
                action?.();
              }}
            >
              Discard changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <AddUserModal
        key={String(add)}
        isOpen={add}
        onClose={() => setAdd(false)}
        onSaved={async (id) => {
          await refresh(id);
          setRefreshKey((value) => value + 1);
        }}
      />
      <SessionPreview
        reference={preview}
        onClose={() => {
          setPreview("");
          const url = new URL(location.href);
          url.searchParams.delete("file");
          history.replaceState({}, "", url);
        }}
      />
    </div>
  );
}
class PortalBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="initial-loading">
        <Panel title="Could not display the portal">
          <Notice error>{this.state.error.message}</Notice>
          <Button onPress={() => location.reload()}>Reload</Button>
        </Panel>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("portal")).render(
  <HeroUIProvider locale="en-US">
    <PortalBoundary>
      <Portal />
    </PortalBoundary>
  </HeroUIProvider>,
);
