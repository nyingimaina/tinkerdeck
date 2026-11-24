import styles from "./EmptyState.module.css";

interface Props {
  title: string;
  buttonLabel: string;
  onClick: () => void;
}

export function EmptyState({ title, buttonLabel, onClick }: Props) {
  return (
    <div className={styles.empty}>
      <img src="/icon.svg" alt="" width="72" height="72" />
      <p>{title}</p>
      <button onClick={onClick}>{buttonLabel}</button>
    </div>
  );
}
