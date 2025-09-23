export function PlaylistSkeleton() {
  return (
    <div className="playlist-skeleton">
      <div className="skeleton-header">
        <div className="skeleton-title" />
        <div className="skeleton-description" />
      </div>

      <div className="skeleton-tracks">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="skeleton-track">
            <div className="skeleton-track-number" />
            <div className="skeleton-track-info">
              <div className="skeleton-track-name" />
              <div className="skeleton-track-artist" />
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .playlist-skeleton {
          margin-top: 2rem;
          animation: pulse 2s infinite;
        }

        .skeleton-header {
          margin-bottom: 1.5rem;
        }

        .skeleton-title {
          height: 2rem;
          width: 60%;
          background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
          border-radius: 4px;
          margin-bottom: 0.5rem;
        }

        .skeleton-description {
          height: 1.2rem;
          width: 80%;
          background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
          border-radius: 4px;
        }

        .skeleton-track {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .skeleton-track-number {
          width: 2rem;
          height: 2rem;
          background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
          border-radius: 4px;
        }

        .skeleton-track-info {
          flex: 1;
        }

        .skeleton-track-name {
          height: 1rem;
          width: 70%;
          background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
          border-radius: 4px;
          margin-bottom: 0.25rem;
        }

        .skeleton-track-artist {
          height: 0.875rem;
          width: 40%;
          background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%);
          background-size: 200% 100%;
          animation: loading 1.5s infinite;
          border-radius: 4px;
        }

        @keyframes loading {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.8;
          }
        }
      `}</style>
    </div>
  );
}