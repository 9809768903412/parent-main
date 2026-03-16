import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import HomePage from './frontend/screens/HomePage';
import Login from './frontend/screens/Login';
import Registration from './frontend/screens/Registration';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

export default function App() {
  const MScreen = createNativeStackNavigator();
  return (
    <NavigationContainer>
      <>
        <MScreen.Navigator>
          <MScreen.Screen name='login' component={Login}/>
          <MScreen.Screen name='register' component={Registration}/>
          <MScreen.Screen name='home' component={HomePage}/>
        </MScreen.Navigator>
      </>
    </NavigationContainer>
  )
}