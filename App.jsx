import { useState, useEffect } from 'react';
import { auth, provider, db } from './firebase';
import { signInWithPopup } from 'firebase/auth';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';

function App() {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);

  // Логин через Google
  const login = () => signInWithPopup(auth, provider).then(res => setUser(res.user));

  // Подписка на задачи в реальном времени
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, [user]);

  if (!user) return (
    <div className="h-screen flex items-center justify-center bg-slate-900">
      <button onClick={login} className="p-4 bg-white/10 backdrop-blur-md rounded-xl text-white">Войти через Google</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 to-slate-900 p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Задачи команды</h1>
      <div className="grid gap-4">
        {tasks.map(task => (
          <div key={task.id} className="bg-white/5 backdrop-blur-lg border border-white/10 p-5 rounded-2xl shadow-lg">
            <h3 className="text-lg font-medium text-white">{task.title}</h3>
            <p className="text-white/50">{task.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;