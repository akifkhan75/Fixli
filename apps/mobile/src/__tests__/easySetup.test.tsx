import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { renderWithStore } from '../testSupport/render';
import * as api from '../services/api';
import { SpeakButton } from '../components/ds/SpeakButton';
import PricingScreen from '../../app/(worker-setup)/setup/pricing';
import LoginScreen from '../../app/(auth)/login';

jest.mock('../hooks/useI18n', () => {
  const i18n = jest.requireActual('../i18n');
  return { useI18n: () => ({ t: i18n.t, tn: i18n.tn, locale: 'en', isRtl: false }) };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: jest.fn(async () => [{ language: 'en-US' }]) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../hooks/useCountry', () => {
  const { COUNTRIES } = jest.requireActual('@fixli/shared');
  return { useCountry: () => ({ country: 'PK', config: COUNTRIES.PK, countries: [COUNTRIES.PK], setCountry: jest.fn() }) };
});
jest.mock('../services/api', () => ({
  ...jest.requireActual('../services/api'),
  getWorkerMe: jest.fn(), patchWorkerMe: jest.fn(), startLoginCode: jest.fn(), loginWithCode: jest.fn(),
}));
const mocked = api as jest.Mocked<typeof api>;

describe('read aloud', () => {
  it('speaks the text, and stops on the second tap', async () => {
    const view = renderWithStore(<SpeakButton text="Choose your work" />);
    fireEvent.press(view.getByLabelText('Read this aloud'));
    expect(Speech.speak).toHaveBeenCalledWith('Choose your work', expect.objectContaining({ language: 'en-US' }));
    fireEvent.press(view.getByLabelText('Stop reading'));
    expect(Speech.stop).toHaveBeenCalled();
  });
});

describe('prices in three choices', () => {
  const me = { currency: 'PKR', pricingModel: null, minimumCallOutFee: null, hourlyRate: null, activationStatus: 'ONBOARDING', onboarding: { missing: ['documents'] } } as unknown as api.WorkerMe;
  beforeEach(() => { jest.clearAllMocks(); mocked.getWorkerMe.mockResolvedValue(me); mocked.patchWorkerMe.mockResolvedValue(me); });
  const open = async () => {
    const view = renderWithStore(<PricingScreen />);
    await waitFor(() => view.getByText('I price after I see it'));
    return view;
  };

  it.each([
    ['', { pricingModel: 'QUOTE' }],
    ['500', { pricingModel: 'CALLOUT_PLUS_QUOTE', minimumCallOutFee: 50_000 }],
  ])('"after I see it" with visit fee "%s"', async (fee, patch) => {
    const view = await open();
    fireEvent.press(view.getByText('I price after I see it'));
    if (fee) fireEvent.changeText(view.getByLabelText('Visit fee (PKR), leave empty if free'), fee);
    await act(async () => { fireEvent.press(view.getByText('Save')); });
    expect(mocked.patchWorkerMe).toHaveBeenCalledWith(patch);
  });

  it('asks for an amount before saving an hourly price', async () => {
    const view = await open();
    fireEvent.press(view.getByText('Per hour'));
    await act(async () => { fireEvent.press(view.getByText('Save')); });
    expect(mocked.patchWorkerMe).not.toHaveBeenCalled();
    expect(view.getByText('Enter an amount, for example 1500.')).toBeTruthy();
  });
});

describe('signing in with a texted code', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs only the number, then the code', async () => {
    mocked.startLoginCode.mockResolvedValue({ resendInSeconds: 60, expiresInMinutes: 10 });
    mocked.loginWithCode.mockResolvedValue({ user: { id: 'u', name: 'A', type: 'customer' }, token: 't', refreshToken: 'r' } as any);
    const view = renderWithStore(<LoginScreen />);
    expect(view.queryByTestId('password-input')).toBeNull();
    fireEvent.changeText(view.getByTestId('phone-input'), '03001234567');
    await act(async () => { fireEvent.press(view.getByText('Send me a code')); });
    expect(mocked.startLoginCode).toHaveBeenCalledWith('+923001234567', 'PK');
    fireEvent.changeText(view.getByLabelText(/code/i), '123456');
    await act(async () => { fireEvent.press(view.getByText('Sign In')); });
    expect(mocked.loginWithCode).toHaveBeenCalledWith('+923001234567', 'PK', '123456');
  });

  it('the password is still there for people who want it', () => {
    const view = renderWithStore(<LoginScreen />);
    fireEvent.press(view.getByText('Use my password instead'));
    expect(view.getByTestId('password-input')).toBeTruthy();
  });
});
