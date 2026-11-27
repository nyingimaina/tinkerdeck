import { useEffect, useRef, type KeyboardEvent } from "react";
import ZestTabs, { type ZestTabItem } from "jattac.libs.web.zest-tabs";
import styles from "./SidebarTabs.module.css";

/** The two sidebar tabs. The last chosen one is not remembered in this revision (R1). */
export type SidebarTab = "projects" | "files";

/** Stable ids so each tab and its panel can reference one another for assistive technology (R5). */
export const sidebarTabId = (tab: SidebarTab): string => `sidebar-tab-${tab}`;
export const sidebarPanelId = (tab: SidebarTab): string => `sidebar-panel-${tab}`;

interface Props {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
}

const TABS: ZestTabItem<SidebarTab>[] = [
  { value: "projects", label: "Projects" },
  { value: "files", label: "Files" },
];

/**
 * A thin adapter over jattac.libs.web.zest-tabs (USR-001) for the Projects | Files strip. The
 * library already supplies role=tablist/role=tab, aria-selected, a roving tabindex, ArrowLeft/Right
 * selection and a focus ring; this adds only the Enter/Space activation its div-based tabs lack and
 * the accessible name of the strip (R5). Both tabs keep a text label and the active one is bold and
 * underlined as well as announced, so the selection is never shown by colour alone (R5).
 */
export function SidebarTabs({ active, onChange }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);

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
        items={TABS}
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
    </div>
  );
}
