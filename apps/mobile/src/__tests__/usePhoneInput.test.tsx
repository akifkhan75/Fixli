import { renderHook, act } from '@testing-library/react-native';
import { usePhoneInput } from '../forms/usePhoneInput';

describe('usePhoneInput', () => {
  const setup = async (country: any = 'PK', open: any[] = ['PK', 'AE']) => {
    const setCountry = jest.fn();
    const hook = await renderHook(() => usePhoneInput(country, setCountry, open));
    return { hook, setCountry };
  };

  it('masks as the user types and validates', async () => {
    const { hook } = await setup();
    await act(async () => { hook.result.current.onChangeText('03001234567'); });
    expect(hook.result.current.text).toBe('0300 1234567');
    expect(hook.result.current.isValid).toBe(true);
    expect(hook.result.current.result.e164).toBe('+923001234567');
  });

  it('does not show an error while typing, only after blur', async () => {
    const { hook } = await setup();
    await act(async () => { hook.result.current.onChangeText('0300 12'); });
    expect(hook.result.current.error).toBeUndefined();
    await act(async () => { hook.result.current.onBlur(); });
    expect(hook.result.current.error).toMatch(/too short/i);
  });

  it('accepts Urdu digits', async () => {
    const { hook } = await setup();
    await act(async () => { hook.result.current.onChangeText('۰۳۰۰۱۲۳۴۵۶۷'); });
    expect(hook.result.current.result.e164).toBe('+923001234567');
  });

  it('switches country when a number from another open country is pasted', async () => {
    const { hook, setCountry } = await setup('PK', ['PK', 'AE']);
    await act(async () => { hook.result.current.onChangeText('+971501234567'); });
    expect(setCountry).toHaveBeenCalledWith('AE');
  });

  it('does not switch to a country that is not open', async () => {
    const { hook, setCountry } = await setup('PK', ['PK']);
    await act(async () => { hook.result.current.onChangeText('+971501234567'); });
    expect(setCountry).not.toHaveBeenCalled();
  });
});
