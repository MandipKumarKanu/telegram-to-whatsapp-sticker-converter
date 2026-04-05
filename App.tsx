import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './app/screens/HomeScreen';
import PreviewScreen from './app/screens/PreviewScreen';
import SuccessScreen from './app/screens/SuccessScreen';
import ErrorBoundary from './app/components/ErrorBoundary';
import { StatusBar } from 'expo-status-bar';

type RootStackParamList = {
  Home: undefined;
  Preview: { packName: string; initialCustomPackName?: string };
  Success: {
    sentPackCount: number;
    exportedStickerCount: number;
    packDisplayName: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <ErrorBoundary>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator
          id="main-stack"
          screenOptions={{
            headerStyle: { backgroundColor: '#1E293B' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
            contentStyle: { backgroundColor: '#0F172A' }
          }}
        >
          <Stack.Screen 
            name="Home" 
            component={HomeScreen} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="Preview" 
            component={PreviewScreen} 
            options={{ headerShown: false }} 
          />
          <Stack.Screen 
            name="Success" 
            component={SuccessScreen} 
            options={{ headerShown: false }} 
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}
