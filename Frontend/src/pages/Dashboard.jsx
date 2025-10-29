import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  FaSearch, FaUpload, FaFileAlt, FaCheck, FaMapMarkerAlt, FaBriefcase, FaUserTie,
  FaGithub, FaLinkedin, FaTimes, FaSignOutAlt, FaEdit, FaTrash
} from 'react-icons/fa';
import ResumeAnalyzer from './ResumeAnalyzer';
import axios from 'axios';

const Dashboard = () => {
  const [jobDescription, setJobDescription] = useState('');
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  const pollIntervalRef = useRef(null);
  const lastLoadedJobIdRef = useRef(null);

  // JD processing states
  const [jdProcessingState, setJdProcessingState] = useState(null);
  const [structuredJD, setStructuredJD] = useState(null);
  const [generatedPrompts, setGeneratedPrompts] = useState(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [editablePrompts, setEditablePrompts] = useState({ linkedin: '', github: '' });
  const [searchHistory, setSearchHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'old'
  const [activeSection, setActiveSection] = useState('search'); // 'search' | 'saved'
  const [historyIndex, setHistoryIndex] = useState(0);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [savedGroups, setSavedGroups] = useState({});
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [showSavedEdit, setShowSavedEdit] = useState(false);
  const [savedEditForm, setSavedEditForm] = useState({ job_id: '', candidate_link: '', name: '', notes: '', contacted: false, review: '' });
  const [savedLinks, setSavedLinks] = useState(new Set());
  const [toasts, setToasts] = useState([]);
  const [resumeUploadFile, setResumeUploadFile] = useState(null);


  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const API_URL = 'http://localhost:5000';
  const FASTAPI_URL = 'http://127.0.0.1:8000';

  // Load search history on mount
  const loadSearchHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(`${FASTAPI_URL}/sourcing-jobs`);
      const data = await response.json();
      const jobs = (data.jobs || [])
        .filter((j) => j.status === 'completed' && (j.candidate_count || 0) > 0)
        .slice(0, 10);
      setSearchHistory(jobs);
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadSavedForJob = async (jobId) => {
    if (!jobId) return;
    try {
      const res = await fetch(`${FASTAPI_URL}/saved-candidates?job_id=${encodeURIComponent(jobId)}`);
      const data = await res.json();
      const setLinks = new Set((data.items || []).map(i => i.candidate_link));
      setSavedLinks(setLinks);
    } catch (e) {
      console.error('Failed to load saved for job', e);
      setSavedLinks(new Set());
    }
  };

  const openSavedEditModal = (item) => {
    setSavedEditForm({
      job_id: item.job_id || '',
      candidate_link: item.candidate_link || '',
      name: item.name || '',
      notes: item.notes || '',
      contacted: !!item.contacted,
      review: typeof item.review === 'number' ? String(item.review) : '',
      email: item.email || '',
      linkedin: item.linkedin || '',
    });
    setResumeUploadFile(null);
    setShowSavedEdit(true);
  };

  const closeSavedEditModal = () => {
    setShowSavedEdit(false);
  };

  const pushToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  const submitSavedEdit = async () => {
    try {
      const payload = {
        job_id: savedEditForm.job_id,
        candidate_link: savedEditForm.candidate_link,
        name: savedEditForm.name || undefined,
        notes: savedEditForm.notes || undefined,
        contacted: !!savedEditForm.contacted,
        review: savedEditForm.review ? Math.max(1, Math.min(5, parseInt(savedEditForm.review, 10))) : undefined,
        email: savedEditForm.email || undefined,
        linkedin: savedEditForm.linkedin || undefined,
      };
      await fetch(`${FASTAPI_URL}/saved-candidates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await loadSavedCandidatesGrouped();
      setShowSavedEdit(false);
      pushToast('Saved candidate updated', 'success');
    } catch (e) {
      console.error('Failed to update saved candidate', e);
      pushToast('Failed to update candidate', 'error');
    }
  };

  // Save candidate action
  const handleSaveCandidate = async (jobId, candidate) => {
    try {
      await fetch(`${FASTAPI_URL}/saved-candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          candidate_link: candidate.link,
          name: candidate.name,
        }),
      });
      if (activeSection === 'saved') loadSavedCandidatesGrouped();
      setSavedLinks(prev => new Set([...prev, candidate.link]));
      pushToast('Candidate saved', 'success');
    } catch (e) {
      console.error('Save failed', e);
      pushToast('Failed to save candidate', 'error');
    }
  };

  const handleDeleteSaved = async (jobId, candidateLink) => {
    try {
      const url = `${FASTAPI_URL}/saved-candidates?job_id=${encodeURIComponent(jobId)}&candidate_link=${encodeURIComponent(candidateLink)}`;
      await fetch(url, { method: 'DELETE' });
      await loadSavedCandidatesGrouped();
      if (currentJobId === jobId) {
        setSavedLinks(prev => {
          const n = new Set([...prev]);
          n.delete(candidateLink);
          return n;
        });
      }
      pushToast('Removed from saved', 'success');
    } catch (e) {
      console.error('Failed to delete saved candidate', e);
      pushToast('Failed to remove saved candidate', 'error');
    }
  };

  const handleUploadResume = async () => {
    try {
      if (!resumeUploadFile) {
        pushToast('Choose a resume file first', 'warning');
        return;
      }
      const form = new FormData();
      form.append('file', resumeUploadFile);
      form.append('job_id', savedEditForm.job_id);
      form.append('candidate_link', savedEditForm.candidate_link);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/saved-candidates/resume`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      await loadSavedCandidatesGrouped();
      pushToast('Resume uploaded', 'success');
      setResumeUploadFile(null);
    } catch (e) {
      console.error('Upload resume failed', e);
      pushToast('Failed to upload resume', 'error');
    }
  };

  // Build a lightweight structured JD from prompts if not stored
  const deriveStructuredJD = (job) => {
    if (!job) return null;
    const lp = job.linkedin_prompt || '';
    const gp = job.github_prompt || '';
    const text = lp || gp;
    if (!text) return null;

    // Extract job title: take text before ' with ' or ' in '
    let job_title = text;
    const lower = text.toLowerCase();
    const cutWith = lower.indexOf(' with ');
    const cutIn = lower.indexOf(' in ');
    let cut = -1;
    if (cutWith !== -1 && cutIn !== -1) cut = Math.min(cutWith, cutIn);
    else cut = cutWith !== -1 ? cutWith : cutIn;
    if (cut !== -1) job_title = text.slice(0, cut).trim();

    // Extract location: after ' in '
    let location = null;
    if (cutIn !== -1) {
      location = text.slice(cutIn + 4).split(/[.,\n]/)[0].trim();
    }

    // Extract experience: look for patterns like '7+','7+ years','7 years'
    let experience_required = null;
    const expMatch = text.match(/(\d+\+?\s*years?)/i) || text.match(/(\d+\+)/i) || text.match(/(\d+)/);
    if (expMatch) experience_required = expMatch[1];

    // Extract skills: after 'with ' up to next period/comma; split by commas or 'and'
    let skills_required = [];
    const withIdx = lower.indexOf(' with ');
    if (withIdx !== -1) {
      const after = text.slice(withIdx + 6).split(/[.\n]/)[0];
      const parts = after.split(/,| and |\s+/).map(s => s.trim()).filter(Boolean);
      // Filter out common words
      const stop = new Set(['in', 'the', 'a', 'an', 'of', 'for', 'to', 'on', 'and', 'with', 'developer', 'engineer']);
      const uniq = [];
      parts.forEach(p => {
        const key = p.replace(/[^a-z0-9+#.]/gi, '');
        if (key && !stop.has(key.toLowerCase()) && !uniq.includes(key)) uniq.push(key);
      });
      skills_required = uniq.slice(0, 8);
    }

    return {
      job_title: job_title || null,
      company: null,
      location: location || null,
      experience_required: experience_required,
      skills_required,
      job_type: null,
      salary_range: null,
    };
  };

  useEffect(() => {
    loadSearchHistory();
  }, []);

  // When switching to Saved section, fetch saved candidates grouped
  useEffect(() => {
    if (activeSection === 'saved') {
      loadSavedCandidatesGrouped();
    }
  }, [activeSection]);

  // When entering Old tab, load the selected history job results
  useEffect(() => {
    if (activeSection === 'search' && activeTab === 'old' && searchHistory.length > 0) {
      const idx = Math.min(historyIndex, searchHistory.length - 1);
      const jobId = searchHistory[idx].job_id;
      if (lastLoadedJobIdRef.current !== jobId) {
        lastLoadedJobIdRef.current = jobId;
        loadPreviousSearch(jobId);
      }
    }
  }, [activeSection, activeTab, historyIndex, searchHistory]);

  // Re-load history after a successful search
  useEffect(() => {
    if (!isLoading && results && results.candidates && results.candidates.length > 0) {
      loadSearchHistory();
    }
  }, [results, isLoading]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    if (selectedFile) {
      setJobDescription('');
      setStructuredJD(null);
      setGeneratedPrompts(null);
      setJdProcessingState(null);
      setShowPrompts(false);
    }
  };

  const processJD = async () => {
    if (!jobDescription && !file) {
      alert('Please provide a job description or upload a file');
      return;
    }

    setJdProcessingState('processing');
    setLoadingMessage('Processing job description...');

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();

      if (file) {
        formData.append('file', file);
      } else if (jobDescription) {
        formData.append('jd_text', jobDescription);
      }

      const response = await axios.post(
        `${API_URL}/api/process-jd`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      if (response.data.success) {
        setStructuredJD(response.data.structured_jd);
        setGeneratedPrompts({
          linkedin: response.data.linkedin_prompt,
          github: response.data.github_prompt
        });
        setEditablePrompts({
          linkedin: response.data.linkedin_prompt,
          github: response.data.github_prompt
        });
        setJdProcessingState('completed');
        setShowPrompts(true);
        setLoadingMessage('');
      } else {
        throw new Error('Failed to process job description');
      }
    } catch (error) {
      console.error('Error processing JD:', error);
      setResults({ error: error.response?.data?.error || 'Failed to process job description' });
      setJdProcessingState(null);
    }
  };

  const pollForResults = (jobId) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    pollIntervalRef.current = setInterval(async () => {
      try {
        setLoadingMessage('Searching for candidates...');
        const response = await fetch(`${FASTAPI_URL}/sourcing-jobs/${jobId}/results`);
        const data = await response.json();

        if (data.candidates && data.candidates.length > 0) {
          setResults(data);
        }

        if (data.status === 'completed') {
          clearInterval(pollIntervalRef.current);
          setIsLoading(false);
          setLoadingMessage('');
          setResults(data);
        } else if (data.status === 'failed') {
          clearInterval(pollIntervalRef.current);
          setIsLoading(false);
          setResults({ error: data.detail || 'Job failed' });
        } else {
          setLoadingMessage(`Found ${data.candidate_count || 0} candidates... Still searching...`);
        }
      } catch (error) {
        console.error('Polling error:', error);
        if (error.response?.status === 404) {
          setResults({ error: 'Job not found' });
          setIsLoading(false);
          clearInterval(pollIntervalRef.current);
        }
      }
    }, 5000);
  };

  const handleStartSearch = async () => {
    if (!editablePrompts.linkedin && !editablePrompts.github) {
      alert('Please provide at least one prompt (LinkedIn or GitHub)');
      return;
    }

    setIsLoading(true);
    setResults(null);
    setLoadingMessage('Creating sourcing job...');
    setShowPrompts(false);

    try {
      const response = await fetch(`${FASTAPI_URL}/sourcing-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          linkedin_prompt: editablePrompts.linkedin,
          github_prompt: editablePrompts.github,
          structured_jd: structuredJD,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const jobData = await response.json();
      const { job_id } = jobData;

      if (job_id) {
        setLoadingMessage('Job created successfully! Now polling for results...');
        setCurrentJobId(job_id);
        loadSavedForJob(job_id);
        pollForResults(job_id);
      } else {
        throw new Error("Did not receive a job_id from the server.");
      }
    } catch (error) {
      console.error('Error creating sourcing job:', error);
      setResults({ error: 'Failed to create the sourcing job. Is the server running?' });
      setIsLoading(false);
    }
  };

  const loadPreviousSearch = async (jobId) => {
    setIsLoading(true);
    setResults(null);
    setLoadingMessage('Loading previous search results...');

    try {
      const response = await fetch(`${FASTAPI_URL}/sourcing-jobs/${jobId}/results`);
      const data = await response.json();
      setResults(data);
      setCurrentJobId(jobId);
      loadSavedForJob(jobId);
      setIsLoading(false);
      setLoadingMessage('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Error loading previous search:', error);
      setResults({ error: 'Failed to load previous search results' });
      setIsLoading(false);
    }
  };

  const loadSavedCandidatesGrouped = async () => {
    setLoadingSaved(true);
    try {
      const res = await fetch(`${FASTAPI_URL}/saved-candidates/grouped`);
      const data = await res.json();
      setSavedGroups(data.groups || {});
    } catch (e) {
      console.error('Failed to load saved candidates:', e);
      setSavedGroups({});
    } finally {
      setLoadingSaved(false);
    }
  };

  const getUserInitials = () => {
    if (!user?.name) return 'U';
    const names = user.name.split(' ');
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return user.name.substring(0, 2).toUpperCase();
  };

  useEffect(() => {
    loadSearchHistory();
    loadSavedCandidatesGrouped();
  }, []);

  // (Removed duplicate effect that reloaded old searches)

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r p-4 hidden md:block">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Menu</h2>
        <nav className="space-y-2">
          <button
            onClick={() => { setActiveSection('search'); setActiveTab('new'); }}
            className={`w-full text-left px-3 py-2 rounded ${activeSection === 'search' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
          >
            Search Candidates
          </button>
          <button
            onClick={() => setActiveSection('saved')}
            className={`w-full text-left px-3 py-2 rounded ${activeSection === 'saved' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
          >
            Saved Candidates
          </button>
          <button
            onClick={() => setActiveSection('resume')}
            className={`w-full text-left px-3 py-2 rounded ${activeSection === 'resume' ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
          >
            Resume Analyzer
          </button>
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Top Header */}
        <header className="bg-white shadow-sm border-b sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  Scoutly
                </h1>
                <span className="text-sm text-gray-500">Welcome, {user?.name?.split(' ')[0] || 'User'}</span>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={() => handleLogout()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition"
                >
                  <FaSignOutAlt /> Logout
                </button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm">
                  {getUserInitials()}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Tabs (within Search Candidates section) */}
        {activeSection === 'search' && (
          <div className="bg-white border-b">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab('new')}
                  className={`px-6 py-3 text-sm font-semibold transition ${activeTab === 'new'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  New Search
                </button>
                <button
                  onClick={() => setActiveTab('old')}
                  className={`px-6 py-3 text-sm font-semibold transition ${activeTab === 'old'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Old Searches
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Resume Analyzer Section */}
        {activeSection === 'resume' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <ResumeAnalyzer nodeApiUrl={API_URL} currentJobId={currentJobId} />
          </div>
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          {/* Toasts */}
          {toasts.length > 0 && (
            <div className="fixed top-4 right-4 z-50 space-y-2">
              {toasts.map(t => (
                <div key={t.id} className={`px-4 py-2 rounded shadow text-white ${t.type==='success'?'bg-emerald-600':t.type==='error'?'bg-red-600':t.type==='warning'?'bg-yellow-600':'bg-gray-800'}`}>
                  {t.message}
                </div>
              ))}
            </div>
          )}
          {/* New Search Tab */}
          {activeSection === 'search' && activeTab === 'new' && (
            <>
              {/* JD Input Section */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 mb-8">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Start New Search</h2>
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Job Description
                    </label>
                    <textarea
                      className="w-full border border-gray-300 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                      placeholder="Paste a Job Description (JD) here or upload a file..."
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      disabled={!!file}
                      rows={8}
                    />
                  </div>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
                      <span className="text-sm font-semibold text-gray-500">or</span>
                      <label htmlFor="file-upload" className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-700 font-medium transition shadow-sm">
                        <FaUpload /> Upload File
                      </label>
                      <input
                        id="file-upload"
                        type="file"
                        accept=".txt,.md,.pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => handleFileChange(e)}
                      />
                      {file && (
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-700">{file.name}</p>
                          <button
                            onClick={() => {
                              setFile(null);
                              setStructuredJD(null);
                              setGeneratedPrompts(null);
                              setShowPrompts(false);
                            }}
                            className="text-xs text-red-600 hover:text-red-700 mt-1"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex gap-4">
                  <button
                    onClick={processJD}
                    disabled={(!jobDescription && !file) || jdProcessingState === 'processing'}
                    className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-md hover:shadow-lg"
                  >
                    {jdProcessingState === 'processing' ? 'Processing...' : 'Process Job Description'}
                  </button>
                </div>
              </div>

              {/* Structured JD Display */}
              {structuredJD && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 mb-8">
                  <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <FaCheck className="text-green-600" /> Job Description Processed
                  </h2>
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {structuredJD.job_title && (
                        <div className="flex items-start gap-3">
                          <FaBriefcase className="text-blue-600 mt-1" />
                          <div>
                            <p className="text-sm font-medium text-gray-600">Job Title</p>
                            <p className="text-lg font-bold text-gray-900">{structuredJD.job_title}</p>
                          </div>
                        </div>
                      )}
                      {structuredJD.location && (
                        <div className="flex items-start gap-3">
                          <FaMapMarkerAlt className="text-blue-600 mt-1" />
                          <div>
                            <p className="text-sm font-medium text-gray-600">Location</p>
                            <p className="text-lg font-bold text-gray-900">{structuredJD.location}</p>
                          </div>
                        </div>
                      )}
                      {structuredJD.experience_required && (
                        <div className="flex items-start gap-3">
                          <FaUserTie className="text-blue-600 mt-1" />
                          <div>
                            <p className="text-sm font-medium text-gray-600">Experience</p>
                            <p className="text-lg font-bold text-gray-900">{structuredJD.experience_required}</p>
                          </div>
                        </div>
                      )}
                      {Array.isArray(structuredJD.skills_required) && structuredJD.skills_required.length > 0 && (
                        <div className="flex items-start gap-3">
                          <FaMapMarkerAlt className="text-blue-600 mt-1" />
                          <div>
                            <p className="text-sm font-medium text-gray-600">Skills</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {structuredJD.skills_required.slice(0, 6).map((skill, idx) => (
                                <span key={idx} className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Prompts Section */}
              {showPrompts && generatedPrompts && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 mb-8">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">Review & Edit Search Prompts</h2>

                  <div className="space-y-6">
                    <div>
                      <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                        <FaLinkedin className="text-blue-600" /> LinkedIn Search Prompt
                      </label>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                        value={editablePrompts.linkedin}
                        onChange={(e) => setEditablePrompts({ ...editablePrompts, linkedin: e.target.value })}
                        rows={4}
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                        <FaGithub className="text-gray-700" /> GitHub Search Prompt
                      </label>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                        value={editablePrompts.github}
                        onChange={(e) => setEditablePrompts({ ...editablePrompts, github: e.target.value })}
                        rows={4}
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex gap-4">
                    <button
                      onClick={handleStartSearch}
                      disabled={isLoading || (!editablePrompts.linkedin && !editablePrompts.github)}
                      className="px-8 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-md hover:shadow-lg"
                    >
                      <FaSearch className="inline mr-2" />
                      Start Search
                    </button>
                    <button
                      onClick={() => setShowPrompts(false)}
                      className="px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Loading State */}
              {isLoading && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
                  <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-blue-600 font-semibold text-lg">{loadingMessage}</p>
                </div>
              )}

              {/* Error State */}
              {!isLoading && results?.error && (
                <div className="bg-white rounded-xl shadow-sm border border-red-200 p-8 text-center">
                  <p className="text-red-600 font-semibold text-lg">{results.error}</p>
                </div>
              )}

              {/* Results Display */}
              {!isLoading && !results?.error && results && results.candidates && results.candidates.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Search Results</h2>
                    <p className="text-sm text-gray-600">{results.candidate_count || 0} candidates found</p>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2">
                    {results.candidates.map((candidate, index) => {
                      const isGitHub = candidate.source === 'GitHub';
                      const isLinkedIn = candidate.source === 'LinkedIn';
                      const scoreColor = candidate.match_score >= 80 ? 'bg-green-100 text-green-800' :
                        candidate.match_score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-orange-100 text-orange-800';

                      return (
                        <div key={index} className="border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow bg-gradient-to-br from-white to-gray-50">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <h3 className="text-lg font-bold text-gray-900">{candidate.name || 'N/A'}</h3>
                              {candidate.title && (
                                <p className="text-sm text-gray-500 mt-1">{candidate.title}</p>
                              )}
                            </div>
                            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${scoreColor}`}>
                              {candidate.match_score || 0}%
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mb-4">
                            {isLinkedIn && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded">
                                <FaLinkedin /> LinkedIn
                              </span>
                            )}
                            {isGitHub && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded">
                                <FaGithub /> GitHub
                              </span>
                            )}
                          </div>

                          <p className="text-sm text-gray-600 mb-4 line-clamp-3">{candidate.snippet || 'N/A'}</p>

                          {candidate.reasoning && (
                            <p className="text-xs text-gray-500 mb-4 italic">{candidate.reasoning}</p>
                          )}

                          <div className="flex items-center gap-4">
                            <a
                              href={candidate.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition"
                            >
                              View Profile →
                            </a>
                            {savedLinks.has(candidate.link) ? (
                              <span className="text-sm px-3 py-1 rounded bg-emerald-100 text-emerald-700">Saved</span>
                            ) : (
                              <button
                                onClick={() => handleSaveCandidate(currentJobId, candidate)}
                                className="text-sm px-3 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Old Searches (single view with navigation) */}
          {activeSection === 'search' && activeTab === 'old' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
              {isLoading && (
                <div className="text-center py-12">
                  <div className="inline-block w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-blue-600 font-semibold text-lg">{loadingMessage}</p>
                </div>
              )}

              {!isLoading && results?.error && (
                <div className="text-center py-12">
                  <p className="text-red-600 font-semibold text-lg">{results.error}</p>
                </div>
              )}

              {!isLoading && !results?.error && results && (
                <>
                  {/* Navigation */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setHistoryIndex((i) => Math.max(0, i - 1))}
                        disabled={historyIndex === 0}
                        className={`px-3 py-1 rounded border ${historyIndex === 0 ? 'text-gray-300 border-gray-200' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        ← Prev
                      </button>
                      <button
                        onClick={() => setHistoryIndex((i) => Math.min(searchHistory.length - 1, i + 1))}
                        disabled={historyIndex >= searchHistory.length - 1}
                        className={`px-3 py-1 rounded border ${historyIndex >= searchHistory.length - 1 ? 'text-gray-300 border-gray-200' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        Next →
                      </button>
                    </div>
                    <div className="text-sm text-gray-600">{searchHistory.length ? `${historyIndex + 1} / ${searchHistory.length}` : '0 / 0'}</div>
                  </div>

                  {/* JD summary for history */}
                  {(() => {
                    const jd = results.job_details?.structured_jd || deriveStructuredJD(results.job_details);
                    if (!jd) return null;
                    return (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
                        <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                          <FaCheck className="text-green-600" /> Job Description Processed
                        </h2>
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {jd.job_title && (
                              <div className="flex items-start gap-3">
                                <FaBriefcase className="text-blue-600 mt-1" />
                                <div>
                                  <p className="text-sm font-medium text-gray-600">Job Title</p>
                                  <p className="text-lg font-bold text-gray-900">{jd.job_title}</p>
                                </div>
                              </div>
                            )}
                            {jd.location && (
                              <div className="flex items-start gap-3">
                                <FaMapMarkerAlt className="text-blue-600 mt-1" />
                                <div>
                                  <p className="text-sm font-medium text-gray-600">Location</p>
                                  <p className="text-lg font-bold text-gray-900">{jd.location}</p>
                                </div>
                              </div>
                            )}
                            {jd.experience_required && (
                              <div className="flex items-start gap-3">
                                <FaUserTie className="text-blue-600 mt-1" />
                                <div>
                                  <p className="text-sm font-medium text-gray-600">Experience</p>
                                  <p className="text-lg font-bold text-gray-900">{jd.experience_required}</p>
                                </div>
                              </div>
                            )}
                            {Array.isArray(jd.skills_required) && jd.skills_required.length > 0 && (
                              <div className="flex items-start gap-3">
                                <FaMapMarkerAlt className="text-blue-600 mt-1" />
                                <div>
                                  <p className="text-sm font-medium text-gray-600">Skills</p>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {jd.skills_required.slice(0, 6).map((skill, idx) => (
                                      <span key={idx} className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                                        {skill}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Candidates list */}
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">Previous Search Results</h2>
                    <p className="text-sm text-gray-600">{results.candidate_count || 0} candidates found</p>
                  </div>
                  {results.candidates && results.candidates.length > 0 ? (
                    <div className="grid gap-6 md:grid-cols-2">
                      {results.candidates.map((candidate, index) => {
                        const isGitHub = candidate.source === 'GitHub';
                        const isLinkedIn = candidate.source === 'LinkedIn';
                        const scoreColor = candidate.match_score >= 80 ? 'bg-green-100 text-green-800' :
                          candidate.match_score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-orange-100 text-orange-800';

                        return (
                          <div key={index} className="border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow bg-gradient-to-br from-white to-gray-50">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <h3 className="text-lg font-bold text-gray-900">{candidate.name || 'N/A'}</h3>
                                {candidate.title && (
                                  <p className="text-sm text-gray-500 mt-1">{candidate.title}</p>
                                )}
                              </div>
                              <span className={`px-3 py-1 text-xs font-semibold rounded-full ${scoreColor}`}>
                                {candidate.match_score || 0}%
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                              {isLinkedIn && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded">
                                  <FaLinkedin /> LinkedIn
                                </span>
                              )}
                              {isGitHub && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded">
                                  <FaGithub /> GitHub
                                </span>
                              )}
                            </div>

                            <p className="text-sm text-gray-600 mb-4 line-clamp-3">{candidate.snippet || 'N/A'}</p>

                            {candidate.reasoning && (
                              <p className="text-xs text-gray-500 mb-4 italic">{candidate.reasoning}</p>
                            )}

                            <div className="flex items-center gap-4">
                              <a
                                href={candidate.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition"
                              >
                                View Profile →
                              </a>
                              {savedLinks.has(candidate.link) ? (
                                <span className="text-sm px-3 py-1 rounded bg-emerald-100 text-emerald-700">Saved</span>
                              ) : (
                                <button
                                  onClick={() => handleSaveCandidate(searchHistory[historyIndex]?.job_id, candidate)}
                                  className="text-sm px-3 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                >
                                  Save
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">No candidates stored for this search.</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Saved Candidates Section */}
          {activeSection === 'saved' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
              {loadingSaved ? (
                <div className="text-center py-12">
                  <div className="inline-block w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-blue-600 font-semibold text-lg">Loading saved candidates...</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {Object.keys(savedGroups).length === 0 && (
                    <div className="text-center text-gray-500">No saved candidates yet.</div>
                  )}
                  {Object.entries(savedGroups).map(([title, items]) => (
                    <div key={title}>
                      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
                      <div className="grid gap-4 md:grid-cols-2">
                        {items.map((c, idx) => (
                          <div key={idx} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                              <a href={c.candidate_link} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:text-blue-700">{c.name || 'Candidate'}</a>
                              <div className="flex items-center gap-2">
                                {typeof c.review === 'number' && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">{c.review}/5</span>
                                )}
                                <button
                                  onClick={() => handleDeleteSaved(c.job_id, c.candidate_link)}
                                  className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                  title="Delete saved"
                                >
                                  <FaTrash />
                                </button>
                                <button
                                  onClick={() => openSavedEditModal(c)}
                                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                  title="Edit notes & status"
                                >
                                  <FaEdit />
                                </button>
                              </div>
                            </div>
                            {c.notes && <p className="text-sm text-gray-600 mt-2">{c.notes}</p>}
                            <div className="mt-2 text-xs text-gray-500">Contacted: {c.contacted ? 'Yes' : 'No'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit Modal */}
          {showSavedEdit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/40" onClick={closeSavedEditModal}></div>
              <div className="relative bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">Edit Saved Candidate</h3>
                  <button onClick={closeSavedEditModal} className="p-2 text-gray-500 hover:text-gray-700"><FaTimes /></button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea
                      className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={4}
                      value={savedEditForm.notes}
                      onChange={(e) => setSavedEditForm({ ...savedEditForm, notes: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={savedEditForm.contacted}
                        onChange={(e) => setSavedEditForm({ ...savedEditForm, contacted: e.target.checked })}
                      />
                      Contacted
                    </label>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Review (1-5)</label>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        className="w-24 border border-gray-300 rounded-lg p-2"
                        value={savedEditForm.review}
                        onChange={(e) => setSavedEditForm({ ...savedEditForm, review: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        className="w-full border border-gray-300 rounded-lg p-2"
                        value={savedEditForm.email || ''}
                        onChange={(e) => setSavedEditForm({ ...savedEditForm, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn</label>
                      <input
                        type="url"
                        className="w-full border border-gray-300 rounded-lg p-2"
                        value={savedEditForm.linkedin || ''}
                        onChange={(e) => setSavedEditForm({ ...savedEditForm, linkedin: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Attach Resume (PDF/DOCX)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept=".pdf,.docx"
                        onChange={(e) => setResumeUploadFile(e.target.files?.[0] || null)}
                        className="w-full border border-gray-300 rounded-lg p-2"
                      />
                      <button onClick={handleUploadResume} className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">Upload</button>
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={closeSavedEditModal} className="px-4 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                  <button onClick={submitSavedEdit} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
export default Dashboard;