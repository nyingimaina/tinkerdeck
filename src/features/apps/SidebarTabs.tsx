import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import ZestTabs, { type ZestTabItem } from "jattac.libs.web.zest-tabs";
import type { Rollup } from "../../state/model";
import { StatusDot } from "../terminals/StatusDot";
import styles from "./SidebarTabs.module.css";

/** The two sidebar tabs. App remembers the chosen one for the running session (R8). */
export type SidebarTab = "projects" | "files";

/** Stable ids so each tab and its panel can reference one another for assistive technology (R5). */
export const sidebarTabId = (tab: SidebarTab): string => `sidebar-tab-${tab}`;
export const sidebarPanelId = (tab: SidebarTab): string => `sidebar-panel-${tab}`;
/** Id of the visually hidden line that states the roll-up for the Projects tab (R7). */
export const sidebarProjectsStatusId = "sidebar-projects-status";

interface Props {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  /** One roll-up over every app's executable terminals, shown beside the Projects label (R7). */
  projectsRollup: Rollup;
}

/**
 * A thin adapter over jattac.libs.web.zest-tabs (USR-001) for the Projects | Files strip. The
 * library already supplies role=tablist/role=tab, aria-selected, a roving tabindex, ArrowLeft/Right
 * selection and a focus ring; this adds only the Enter/Space activation its div-based tabs lack and
 * the accessible name of the strip (R5). Both tabs keep a text label and the active one is bold and
 * underlined as well as announced, so the selection is never shown by colour alone (R5).
 */
export function SidebarTabs({ active, onChange, projectsRollup }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  // The Projects label carries one roll-up dot drawn from the same label as every other status dot.
  // The dot itself stays decorative so each tab's name is exactly "Projects"/"Files" and the
  // existing role=img counts do not gain a duplicate; assistive technology reads the same roll-up
  // from the tab's description instead (R7, REV-1).
  const items = useMemo<ZestTabItem<SidebarTab>[]>(
    () => [
      {
        value: "projects",
        label: (
          <span className={styles.tabContent}>
            <span className={styles.labelText}>Projects</span>
            <span className={styles.tabDot} aria-hidden="true">
              <StatusDot rollup={projectsRollup} />
            </span>
          </span>
        ),
      },
      {
        value: "files",
        label: (
          <span className={styles.tabContent}>
            <span className={styles.labelText}>Files</span>
          </span>
        ),
      },
    ],
    [projectsRollup],
  );

  // The library names neither its tablist nor its tabs, and does not link a tab to the panel it
  // controls. Name the list and wire each tab's id/aria-controls to its panel once it is in the DOM
  // (R5); the panels carry the matching aria-labelledby.
  useEffect(() => {
    const list = stripRef.current?.querySelector('[role="tablist"]');
    list?.setAttribute("aria-label", "Sidebar sections");
    list?.querySelectorAll<HTMLElement>('[role="tab"]').forEach((element) => {
      const value = element.dataset.value;
      if (value !== "projects" && value !== "files") return;
      element.id = sidebarTabId(value);
      element.setAttribute("aria-controls", sidebarPanelId(value));
      // Link the Projects tab to the hidden status line so its roll-up is announced (R7, REV-1).
      if (value === "projects") element.setAttribute("aria-describedby", sidebarProjectsStatusId);
    });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    const value = tab?.dataset.value;
    if (value !== "projects" && value !== "files") return;
    event.preventDefault();
    onChange(value);
  };

  return (
    <div className={styles.strip} ref={stripRef} onKeyDown={onKeyDown}>
      <ZestTabs<SidebarTab>
        id="sidebar-tabs"
        items={items}
        activeValue={active}
        onChange={onChange}
        unstyled={{ container: true, tab: true, activeTab: true, activePill: true }}
        classNames={{
          container: styles.list,
          tab: styles.tab,
          activeTab: styles.activeTab,
          activePill: styles.pill,
        }}
      />
      {/* Screen readers get the roll-up as the Projects tab's description, without adding a second
          status image or changing either tab's name (R7, REV-1). */}
      <span id={sidebarProjectsStatusId} className={styles.srOnly}>
        App status: {projectsRollup}
      </span>
    </div>
  );
}
