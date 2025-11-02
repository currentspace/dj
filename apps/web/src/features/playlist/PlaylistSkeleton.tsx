import styles from "./PlaylistSkeleton.module.css";

export function PlaylistSkeleton() {
  return (
    <div className={styles.playlistSkeleton}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonDescription} />
      </div>

      <div className={styles.skeletonTracks}>
        {Array.from({ length: 10 }).map((_, index) => (
          <div className={styles.skeletonTrack} key={index}>
            <div className={styles.skeletonTrackNumber} />
            <div className={styles.skeletonTrackInfo}>
              <div className={styles.skeletonTrackName} />
              <div className={styles.skeletonTrackArtist} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
