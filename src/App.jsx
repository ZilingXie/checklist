import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import CallPage from './pages/CallPage.jsx';

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/call" element={<CallPage />} />
    </Routes>
  );
};

export default App;
