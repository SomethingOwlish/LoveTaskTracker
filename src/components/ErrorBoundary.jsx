import { Component } from 'react';

const CHUNK_ERR = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;

// Ловит падение вкладки. Если не загрузился код вкладки (после выкатки новой
// версии) — перезагружаемся через __lttRecover из index.html; иначе показываем
// понятное сообщение вместо пустого экрана.
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    if (CHUNK_ERR.test(String(error?.message || error)) && window.__lttRecover) window.__lttRecover(error.message);
    else console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <p>Что-то пошло не так на этом экране.</p>
        <button className="btn btn-accent" onClick={() => location.reload()}>Обновить</button>
      </div>
    );
  }
}
