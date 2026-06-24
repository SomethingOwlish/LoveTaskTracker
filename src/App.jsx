import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { TaskCard } from './components/TaskCard';

export default function App() {
  const [tab, setTab] = useState('list');
  const [tasks, setTasks] = useState([]);
  const [modal, setModal] = useState(false);

  useEffect(() => {
    return onSnapshot(query(collection(db, "tasks"), orderBy("createdAt", "desc")), 
      (s) => setTasks(s.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  return (
    <div className="max-w-[480px] mx-auto p-4 min-h-screen">
      {/* Навигация */}
      <div className="flex gap-2 mb-6 glass p-1">
        {['list', 'matrix'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 rounded-lg font-bold capitalize ${tab === t ? 'bg-[var(--accent)] text-black' : ''}`}>{t}</button>
        ))}
      </div>

      {tab === 'list' ? (
        <div className="space-y-4">{tasks.map(t => <TaskCard key={t.id} task={t} />)}</div>
      ) : (
        <div className="glass h-[400px] flex items-center justify-center relative">
          <p className="opacity-40 uppercase tracking-widest">Сетка Матрицы</p>
        </div>
      )}

      {/* Кнопка создания */}
      <button className="fixed bottom-6 right-6 md:top-6 md:right-6 w-14 h-14 btn-accent text-2xl shadow-2xl" onClick={() => setModal(true)}>+</button>

      {/* Модалка */}
      {modal && (
        <div className="fixed inset-0 bg-black/80 p-6 flex items-center justify-center z-50">
          <div className="glass w-full p-6 space-y-4">
            <input id="title" className="w-full bg-transparent border-b p-2" placeholder="Название..."/>
            <input id="desc" className="w-full bg-transparent border-b p-2" placeholder="Описание..."/>
            <input id="proj" className="w-full bg-transparent border-b p-2" placeholder="Проект..."/>
            <button className="w-full btn-accent" onClick={async () => {
              await addDoc(collection(db, "tasks"), { title: document.getElementById('title').value, description: document.getElementById('desc').value, project: document.getElementById('proj').value, createdAt: serverTimestamp() });
              setModal(false);
            }}>Сохранить</button>
            <button className="w-full opacity-50" onClick={() => setModal(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}