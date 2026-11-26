import React, { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { useAppSelector } from '../src/hooks/useRedux';
import { selectCurrentUser } from '../src/store/authSlice';

export default function Index() {
  const currentUser = useAppSelector(selectCurrentUser);

  if (!currentUser) {
    return <Redirect href="/(auth)/login" />;
  }

  if (currentUser.type === 'customer') {
    return <Redirect href="/(customer)/(home)" />;
  }

  return <Redirect href="/(worker)/(tabs)/today" />;
}
