import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from './index';

interface Coordinates {
  latitude: number;
  longitude: number;
  heading?: number;
}

interface TrackingState {
  isTracking: boolean;
  trackedWorkerId: string | null;
  /** The job being tracked; the server derives who receives location from it. */
  jobId: string | null;
  workerLocation: Coordinates | null;
  customerLocation: Coordinates | null;
  etaString: string | null;
}

const initialState: TrackingState = {
  isTracking: false,
  trackedWorkerId: null,
  jobId: null,
  workerLocation: null,
  customerLocation: null,
  etaString: null,
};

const trackingSlice = createSlice({
  name: 'tracking',
  initialState,
  reducers: {
    startTracking: (state, action: PayloadAction<{ workerId: string; jobId: string; customerLocation: Coordinates | null }>) => {
      state.isTracking = true;
      state.trackedWorkerId = action.payload.workerId;
      state.jobId = action.payload.jobId;
      state.customerLocation = action.payload.customerLocation;
      state.workerLocation = null;
      state.etaString = 'Calculating...';
    },
    stopTracking: (state) => {
      state.isTracking = false;
      state.trackedWorkerId = null;
      state.jobId = null;
      state.workerLocation = null;
      state.etaString = null;
    },
    updateWorkerLocation: (state, action: PayloadAction<Coordinates>) => {
      state.workerLocation = action.payload;
      // ETA comes from the server's routing provider (Phase 8); never invent one here.
      state.etaString = null;
    },
    updateCustomerLocation: (state, action: PayloadAction<Coordinates>) => {
      state.customerLocation = action.payload;
    }
  },
});

export const { startTracking, stopTracking, updateWorkerLocation, updateCustomerLocation } = trackingSlice.actions;
export const selectTrackingState = (state: RootState) => state.tracking;
export default trackingSlice.reducer;
