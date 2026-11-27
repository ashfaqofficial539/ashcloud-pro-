import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

export async function signInWithGoogleOAuth(): Promise<{
  idToken: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  const email = result.user.email || '';
  const name = result.user.displayName || email.split('@')[0] || 'ASHCLOUD User';
  const avatarUrl = result.user.photoURL || null;

  return { idToken, email, name, avatarUrl };
}

export async function disconnectGoogleOAuth(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore
  }
}
