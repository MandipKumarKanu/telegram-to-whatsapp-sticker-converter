import { useCallback, useRef, useState } from 'react';

interface QueueProgress {
  total: number;
  completed: number;
}

export function useChunkQueue() {
  const cancelRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<QueueProgress>({ total: 0, completed: 0 });
  const [failedChunkIndexes, setFailedChunkIndexes] = useState<number[]>([]);

  const cancelQueue = useCallback(() => {
    cancelRef.current = true;
    setIsRunning(false);
  }, []);

  const runQueue = useCallback(
    async (chunkIndexes: number[], processChunk: (chunkIndex: number) => Promise<void>) => {
      cancelRef.current = false;
      setIsRunning(true);
      setFailedChunkIndexes([]);
      setProgress({ total: chunkIndexes.length, completed: 0 });

      const failed: number[] = [];

      for (let i = 0; i < chunkIndexes.length; i += 1) {
        if (cancelRef.current) {
          break;
        }

        const chunkIndex = chunkIndexes[i];
        if (typeof chunkIndex !== 'number') {
          continue;
        }
        try {
          await processChunk(chunkIndex);
        } catch {
          failed.push(chunkIndex);
        } finally {
          setProgress({ total: chunkIndexes.length, completed: i + 1 });
        }
      }

      setFailedChunkIndexes(failed);
      setIsRunning(false);
      return { cancelled: cancelRef.current, failedChunkIndexes: failed };
    },
    [],
  );

  const resetQueue = useCallback(() => {
    cancelRef.current = false;
    setIsRunning(false);
    setProgress({ total: 0, completed: 0 });
    setFailedChunkIndexes([]);
  }, []);

  return {
    isRunning,
    progress,
    failedChunkIndexes,
    runQueue,
    cancelQueue,
    resetQueue,
  };
}
