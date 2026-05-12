import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle, Phone } from 'lucide-react';

const API_BASE = (() => {
  // Local dev: use env variable pointing to backend port
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
  // Production (Vercel): same domain, no base needed
  return '';
})();

const GlassDropdown = ({ options, value, onChange, name, placeholder = "Select" }) => {
  const [open, setOpen] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const ref = React.useRef();
  const triggerRef = React.useRef();
  const listRef = React.useRef();

  React.useEffect(() => {
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Scroll focused item into view
  React.useEffect(() => {
    if (open && focusedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[focusedIndex];
      if (item) item.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex, open]);

  const select = (opt) => {
    onChange({ target: { name, value: opt } });
    setOpen(false);
    setFocusedIndex(-1);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        // Pre-focus current value or first item
        const idx = value ? options.indexOf(value) : 0;
        setFocusedIndex(idx >= 0 ? idx : 0);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusedIndex >= 0) select(options[focusedIndex]);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        setFocusedIndex(-1);
        break;
      default:
        // Jump to first option starting with typed letter
        const letter = e.key.toLowerCase();
        const match = options.findIndex(o => o.toLowerCase().startsWith(letter));
        if (match >= 0) setFocusedIndex(match);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`dd-list-${name}`}
        tabIndex={0}
        onClick={() => { setOpen(o => !o); setFocusedIndex(value ? options.indexOf(value) : 0); }}
        onKeyDown={handleKeyDown}
        className="w-full bg-black/20 backdrop-blur-lg border border-white/10 rounded-lg px-3 py-2.5 text-white cursor-pointer flex justify-between items-center text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 transition-all"
      >
        <span className={value ? "text-white" : "text-gray-400"}>
          {value || placeholder}
        </span>
        <span className="text-gray-400 text-xs" aria-hidden="true">▼</span>
      </div>
      {open && (
        <div
          id={`dd-list-${name}`}
          ref={listRef}
          role="listbox"
          aria-label={placeholder}
          className="absolute z-50 mt-1 w-full rounded-lg overflow-auto max-h-56 backdrop-blur-xl bg-black/80 border border-black/90 shadow-xl"
        >
          {options.map((opt, i) => (
            <div
              key={i}
              role="option"
              aria-selected={opt === value}
              onClick={() => select(opt)}
              onMouseEnter={() => setFocusedIndex(i)}
              className={`px-4 py-2 text-white cursor-pointer text-sm transition-colors ${
                i === focusedIndex ? "bg-white/30" : "hover:bg-white/20"
              }`}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const LeadForm = () => {
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Playfair+Display:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  // ── DB-fetched dropdown data ──
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [dropdownError, setDropdownError] = useState('');

  useEffect(() => {
    const fetchDropdowns = async () => {
      setLoadingDropdowns(true);
      setDropdownError('');
      try {
        const [projRes, userRes] = await Promise.all([
          fetch(`${API_BASE}/api/projects`),
          fetch(`${API_BASE}/api/users`)
        ]);

        if (!projRes.ok) throw new Error('Failed to load projects');
        if (!userRes.ok) throw new Error('Failed to load users');

        const projData = await projRes.json();
        const userData = await userRes.json();

        setProjects(Array.isArray(projData) ? projData : projData.projects || []);
        setUsers(Array.isArray(userData) ? userData : userData.users || []);
      } catch (err) {
        setDropdownError('Could not load dropdown data. Please refresh the page.');
        console.error('Dropdown fetch error:', err.message);
      } finally {
        setLoadingDropdowns(false);
      }
    };

    fetchDropdowns();
  }, []);

  const getProjectLabel = (p) => p.projectName || p.name || p.title || String(p._id);
  const getUserLabel = (u) => u.fullName || u.name || u.username || String(u._id);

  // ── Form state ──
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    project: '',
    fullName: '', email: '', mobileNumber: '',
    address: '', locality: '', city: '', country: '', pinCode: '',
    visitingFor: '',
    occupation: '', organization: '', industry: '', designation: '',
    officeLocation: '', officePinCode: '',
    purposeOfPurchase: '', propertyType: '',
    currentResidentType: '', budgetRange: '',
    budgetRangeHigher: '', willBuyIn: '',
    hearAboutUs: '', referenceDetails: '',
    channelPartnerCompany: '', channelPartnerName: '',
    channelPartnerMobile: '', channelPartnerRERA: '', channelPartnerEmail: '',
    leadOwner: ''
  });

  const [isMobileFocused, setIsMobileFocused] = useState(false);
  const [checkingMobile, setCheckingMobile] = useState(false);
  const [savedLeadId, setSavedLeadId] = useState(null);   // stores _id after pre-OTP save
  const [otp, setOtp] = useState('');

  // ── Background carousel ──
  const carouselImages = [
    '/images/backdrop.jpeg'
  ];
  const CAROUSEL_INTERVAL = 9000; // ms between image changes
  const FADE_DURATION     = 1500; // ms for blur+fade (must match CSS transition below)

  const [currentBg, setCurrentBg]         = useState(0);
  const [nextBg, setNextBg]               = useState(1);
  const [transitioning, setTransitioning] = useState(false);

useEffect(() => {
  const timer = setInterval(() => {
    setNextBg((currentBg + 1) % carouselImages.length);
    setTransitioning(true);

    setTimeout(() => {
      setCurrentBg((prev) => (prev + 1) % carouselImages.length);
      setTransitioning(false);
    }, FADE_DURATION);
  }, CAROUSEL_INTERVAL);

  return () => clearInterval(timer);
}, [currentBg]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const glassStyle = "bg-white bg-opacity-10 backdrop-filter backdrop-blur-lg border border-white border-opacity-20 rounded-2xl shadow-2xl";
  const inputStyle = "w-full bg-black bg-opacity-20 border border-white border-opacity-10 rounded-lg px-3 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-all text-sm";
  const labelStyle = "text-gray-300 text-xs mb-1.5 block font-light tracking-wide";

  const validateField = (name, value) => {
    switch (name) {
      case 'fullName': return !value || value.trim().length < 2 ? 'Name must be at least 2 characters' : '';
      case 'email': return !value || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value) ? 'Invalid email address' : '';
      case 'address': return !value || value.trim().length < 5 ? 'Address must be at least 5 characters' : '';
      case 'city': return !value || value.trim().length < 2 ? 'City is required' : '';
      case 'project': return !value ? 'Project is required' : '';
      case 'leadOwner': return !value ? 'Lead Owner is required' : '';
      case 'pinCode':
      case 'officePinCode': return value && !/^\d{6}$/.test(value) ? 'Enter valid 6-digit PIN code' : '';
      case 'mobileNumber':
      case 'channelPartnerMobile': return !value || !/^[6-9]\d{9}$/.test(value) ? 'Enter valid 10-digit mobile number' : '';
      default: return '';
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox') {
      setFormData(prev => {
        const arr = prev[name] || [];
        return { ...prev, [name]: checked ? [...arr, value] : arr.filter(i => i !== value) };
      });
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
    if (touched[name]) setErrors(prev => ({ ...prev, [name]: validateField(name, value) }));
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    setErrors(prev => ({ ...prev, [name]: validateField(name, value) }));
  };

  const validateForm = () => {
    const required = ['project', 'fullName', 'email', 'mobileNumber', 'address', 'city', 'leadOwner'];
    const newErrors = {};
    required.forEach(k => { const e = validateField(k, formData[k]); if (e) newErrors[k] = e; });
    ['pinCode', 'officePinCode', 'channelPartnerMobile'].forEach(k => {
      if (formData[k]) { const e = validateField(k, formData[k]); if (e) newErrors[k] = e; }
    });
    setErrors(newErrors);
    setTouched(Object.fromEntries(required.map(k => [k, true])));
    // Also block if a real-time duplicate error is already set
    if (errors.mobileNumber === 'Mobile number already exist') {
      newErrors.mobileNumber = 'Mobile number already exist';
    }
    return Object.keys(newErrors).length === 0;
  };

  // ── GupShup OTP ──
  const sendOTP = async (mobile) => {
    const res = await fetch(`${API_BASE}/api/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, projectName: formData.project }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
    return { success: true };
  };

  // ── Real-time duplicate mobile check on blur ──
  const checkDuplicateMobile = async (mobile) => {
    // Only check if format is valid (10 digits starting 6-9)
    if (!/^[6-9]\d{9}$/.test(mobile)) return;
    setCheckingMobile(true);
    try {
      const res = await fetch(`${API_BASE}/api/leads/check-mobile/${mobile}`);
      const data = await res.json();
      if (data.exists) {
        setErrors(prev => ({ ...prev, mobileNumber: 'Mobile number already exist' }));
        setTouched(prev => ({ ...prev, mobileNumber: true }));
      }
    } catch (e) {
      // silently ignore network errors — server-side check will still catch it
      console.error('Mobile check failed:', e.message);
    } finally {
      setCheckingMobile(false);
    }
  };


  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) { setError('Please fix the errors above'); return; }
    setError(''); setLoading(true);
    try {
      // 1. Save to MongoDB ONLY — skipErp flag prevents Farvision push until OTP is verified
      const response = await fetch(`${API_BASE}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, source: 'Website Form', status: 'New', skipErp: true }),
      });

      const data = await response.json().catch(() => ({}));

      // Duplicate mobile fallback (should be caught onBlur, but just in case)
      if (response.status === 409 || data.error === 'duplicate_mobile') {
        setErrors(prev => ({ ...prev, mobileNumber: 'Mobile number already exist' }));
        setTouched(prev => ({ ...prev, mobileNumber: true }));
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Submission failed. Please try again.');
      }

      // 2. Store the new lead _id so we can PATCH it after OTP
      setSavedLeadId(data._id || data.id);

      // 3. Send OTP via GupShup
      const otpResult = await sendOTP(formData.mobileNumber);
      if (otpResult.success) setStep(2); else throw new Error('Failed to send OTP');
    } catch (err) { setError(err.message || 'Failed to submit. Please try again.'); }
    finally { setLoading(false); }
  };

  const verifyOtpAndSubmit = async () => {
    if (otp.length !== 6) { setError('Please enter 6-digit OTP'); return; }
    setError(''); setLoading(true);
    try {
      // 1. Verify OTP with GupShup store on server
      const verifyRes = await fetch(`${API_BASE}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: formData.mobileNumber, otp }),
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Incorrect OTP. Please try again.');

      // 2. OTP correct — update otpVerification to true AND push to Farvision ERP
      if (savedLeadId) {
        const patchRes = await fetch(`${API_BASE}/api/leads/${savedLeadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otpVerification: true, pushToErp: true }),
        });
        if (!patchRes.ok) {
          const patchData = await patchRes.json().catch(() => ({}));
          throw new Error(patchData.error || 'OTP verification update failed.');
        }
      }

      setStep(3);
    } catch (err) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resendOTP = async () => {
    setOtp(''); setError(''); setLoading(true);
    try { await sendOTP(formData.mobileNumber); } catch (err) { setError(err.message || 'Failed to resend OTP.'); }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setStep(1);
    setFormData({
      project: '',
      fullName: '', email: '', mobileNumber: '',
      address: '', locality: '', city: '', country: '', pinCode: '', visitingFor: 'Self',
      occupation: '', organization: '', industry: '', designation: '',
      officeLocation: '', officePinCode: '', purposeOfPurchase: 'Personal Use',
      propertyType: '3 BHK', currentResidentType: 'Own Residence',
      budgetRange: '1Cr - 1.25Cr', budgetRangeHigher: '', willBuyIn: '',
      hearAboutUs: '', referenceDetails: '', channelPartnerCompany: '',
      channelPartnerName: '', channelPartnerMobile: '', channelPartnerRERA: '',
      channelPartnerEmail: '', leadOwner: ''
    });
    setOtp(''); setError(''); setErrors({}); setTouched({}); setSavedLeadId(null);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 md:p-6 overflow-hidden" style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Carousel Layer A: current image (always fully visible) ── */}
      <div
        className="fixed inset-0"
        style={{
          zIndex: 0,
          backgroundColor: '#111111',
          backgroundImage: `url("${carouselImages[currentBg]}")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center center',
          backgroundSize: 'cover',
          filter: 'blur(0px)',
          transition: `filter ${FADE_DURATION}ms ease`,
        }}
      />

      {/* ── Carousel Layer B: next image fading in over Layer A ── */}
      <div
        className="fixed inset-0"
        style={{
          zIndex: 1,
          backgroundImage: `url("${carouselImages[nextBg]}")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center center',
          backgroundSize: 'cover',
          opacity: transitioning ? 1 : 0,
          filter: transitioning ? 'blur(0px)' : 'blur(8px)',
          transition: `opacity ${FADE_DURATION}ms ease, filter ${FADE_DURATION}ms ease`,
          willChange: 'opacity, filter',
        }}
      />

      {/* ── Grid overlay ── */}
      <div className="absolute inset-0" style={{
        zIndex: 2, opacity: 0.15,
        backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
      }} />

      {/* ── Dark veil ── */}
      <div className="absolute inset-0 bg-black bg-opacity-30" style={{ zIndex: 3 }} />

      {/* Form card */}
      <div className={`${glassStyle} w-full max-w-4xl p-6 md:p-12 transition-all duration-500`} style={{ position: 'relative', zIndex: 10 }}>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="h-16 w-16 mx-auto mb-4 rounded-full overflow-hidden">
            <img src="/images/SilverGroupLogow_oBG.png" alt="Silver Group Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl md:text-4xl font-light text-white tracking-widest uppercase" style={{ fontFamily: "'Playfair Display', serif" }}>
            Silver Group
          </h1>
          <p className="text-gray-300 mt-2 italic font-light">Lead Form</p>
        </div>

        {/* Dropdown loading / error banner */}
        {loadingDropdowns && (
          <div className="mb-6 p-3 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg flex items-center gap-2 text-gray-300 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading form data...
          </div>
        )}
        {dropdownError && (
          <div className="mb-6 p-4 bg-yellow-500 bg-opacity-20 border border-yellow-500 border-opacity-50 rounded-lg text-yellow-200 text-sm">
            ⚠️ {dropdownError}
          </div>
        )}

        {/* Main error */}
        {error && (
          <div className="mb-6 p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-50 rounded-lg text-red-200">
            {error}
          </div>
        )}

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div className="space-y-6">

            {/* Project — from DB */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelStyle}>Project <span className="text-red-400">*</span></label>
                {loadingDropdowns ? (
                  <div className={`${inputStyle} flex items-center gap-2 text-gray-400`}>
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                  </div>
                ) : (
                  <>
                    <GlassDropdown
                      name="project"
                      value={formData.project}
                      onChange={(e) => { handleInputChange(e); handleBlur(e); }}
                      placeholder="Select Project"
                      options={projects.map(p => getProjectLabel(p))}
                    />
                    {errors.project && touched.project && <p className="text-red-400 text-xs mt-1">{errors.project}</p>}
                  </>
                )}
              </div>
            </div>

            {/* Personal Details */}
            <div>
              <h3 className="text-white text-lg font-light mb-4 uppercase tracking-wider border-b border-gray-600 pb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Personal Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelStyle}>Full Name <span className="text-red-400">*</span></label>
                  <input type="text" name="fullName" value={formData.fullName} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter your full name" className={inputStyle} />
                  {errors.fullName && touched.fullName && <p className="text-red-400 text-xs mt-1">{errors.fullName}</p>}
                </div>
                <div>
                  <label className={labelStyle}>Mobile Number <span className="text-red-400">*</span></label>
                  <input type="text" name="mobileNumber" value={formData.mobileNumber} onChange={handleInputChange}
                    onBlur={async (e) => {
                      handleBlur(e);
                      setIsMobileFocused(false);
                      // Clear old duplicate error before re-checking
                      setErrors(prev => ({
                        ...prev,
                        mobileNumber: prev.mobileNumber === 'Mobile number already exist' ? '' : prev.mobileNumber
                      }));
                      await checkDuplicateMobile(e.target.value);
                    }}
                    onFocus={() => setIsMobileFocused(true)}
                    placeholder="Enter mobile number" className={inputStyle} maxLength="10" />
                  {isMobileFocused && !checkingMobile && !errors.mobileNumber && (
                    <p className="text-white text-xs mt-1">OTP will be sent to this number after submission.</p>
                  )}
                  {checkingMobile && (
                    <p className="text-gray-400 text-xs mt-1 flex items-center gap-1">
                      <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                      Checking...
                    </p>
                  )}
                  {errors.mobileNumber && touched.mobileNumber && (
                    <p className="text-red-400 text-xs mt-1">{errors.mobileNumber}</p>
                  )}
                </div>
                <div>
                  <label className={labelStyle}>Email ID <span className="text-red-400">*</span></label>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter email address" className={inputStyle} />
                  {errors.email && touched.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                </div>
                <div>
                  <label className={labelStyle}>Residential Address <span className="text-red-400">*</span></label>
                  <input type="text" name="address" value={formData.address} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter your address" className={inputStyle} />
                  {errors.address && touched.address && <p className="text-red-400 text-xs mt-1">{errors.address}</p>}
                </div>
                <div>
                  <label className={labelStyle}>Locality</label>
                  <input type="text" name="locality" value={formData.locality} onChange={handleInputChange} placeholder="Enter locality" className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>City <span className="text-red-400">*</span></label>
                  <input type="text" name="city" value={formData.city} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter city" className={inputStyle} />
                  {errors.city && touched.city && <p className="text-red-400 text-xs mt-1">{errors.city}</p>}
                </div>
                <div>
                  <label className={labelStyle}>Country</label>
                  <input type="text" name="country" value={formData.country} onChange={handleInputChange} placeholder="Enter country" className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>PIN Code <span className="text-red-400">*</span></label>
                  <input type="text" name="pinCode" value={formData.pinCode} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter PIN code" className={inputStyle} maxLength="6" />
                  {errors.pinCode && touched.pinCode && <p className="text-red-400 text-xs mt-1">{errors.pinCode}</p>}
                </div>
                <div>
                  <label className={labelStyle}>Visiting / Meeting on behalf of</label>
                  <GlassDropdown
                    name="visitingFor"
                    value={formData.visitingFor}
                    onChange={handleInputChange}
                    placeholder="Select Visiting"
                    options={["Self", "Family", "Friend / Colleague"]}
                  />
                </div>
              </div>
            </div>

            {/* Professional Details */}
            <div>
              <h3 className="text-white text-lg font-light mb-4 uppercase tracking-wider border-b border-gray-600 pb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Professional Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelStyle}>Occupation</label>
                  <GlassDropdown
                    name="occupation"
                    value={formData.occupation}
                    onChange={handleInputChange}
                    placeholder="Select Occupation"
                    options={["Salaried", "Self Employed", "Professional", "Retired"]}
                  />
                </div>
                <div>
                  <label className={labelStyle}>Organization</label>
                  <input type="text" name="organization" value={formData.organization} onChange={handleInputChange} placeholder="Enter organization name" className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>Industry</label>
                  <input type="text" name="industry" value={formData.industry} onChange={handleInputChange} placeholder="Enter industry" className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>Designation</label>
                  <input type="text" name="designation" value={formData.designation} onChange={handleInputChange} placeholder="Enter designation" className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>Office Location</label>
                  <input type="text" name="officeLocation" value={formData.officeLocation} onChange={handleInputChange} placeholder="Enter office location" className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>Office PIN Code</label>
                  <input type="text" name="officePinCode" value={formData.officePinCode} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter PIN code" className={inputStyle} maxLength="6" />
                  {errors.officePinCode && touched.officePinCode && <p className="text-red-400 text-xs mt-1">{errors.officePinCode}</p>}
                </div>
              </div>
            </div>

            {/* Essentials */}
            <div>
              <h3 className="text-white text-lg font-light mb-4 uppercase tracking-wider border-b border-gray-600 pb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Essentials</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelStyle}>Purpose of Purchase</label>
                  <GlassDropdown
                    name="purposeOfPurchase"
                    value={formData.purposeOfPurchase}
                    onChange={handleInputChange}
                    placeholder="Select Purpose of Purchase"
                    options={["Personal Use", "Investment", "Second Home"]}
                  />
                </div>
                <div>
                  <label className={labelStyle}>Residential Configuration</label>
                  <GlassDropdown
                    name="propertyType"
                    value={formData.propertyType}
                    onChange={handleInputChange}
                    placeholder="Select Property Type"
                    options={["1 BHK", "2 BHK", "3 BHK (1 +1 JODI)", "4 BHK (2+2 JODI)"]}
                  />
                </div>
                <div>
                  <label className={labelStyle}>Current Resident Type</label>
                  <GlassDropdown
                    name="currentResidentType"
                    value={formData.currentResidentType}
                    onChange={handleInputChange}
                    placeholder="Select Resident Type"
                    options={["Own Residence", "Company Provide", "Rented"]}
                  />
                </div>
                <div>
                  <label className={labelStyle}>Budget Range (Rs.)</label>
                  <GlassDropdown
                    name="budgetRange"
                    value={formData.budgetRange}
                    onChange={handleInputChange}
                    placeholder="Select Budget Range"
                    options={["1Cr - 1.25Cr", "1.26Cr - 1.50 Cr", "1.51Cr - 1.75Cr", "1.76Cr - 2Cr", "2.01Cr - 2.25Cr", "2.26Cr Onwards"]}
                  />
                </div>
                <div>
                  <label className={labelStyle}>Will Buy in (Period)</label>
                  <GlassDropdown
                    name="willBuyIn"
                    value={formData.willBuyIn}
                    onChange={handleInputChange}
                    placeholder="Select Period"
                    options={["3 months", "6 months", "9 months", "12 months", "15 months", "18 months", "21 months", "24 months"]}
                  />
                </div>
              </div>
            </div>

            {/* How Did You Hear */}
            <div>
              <h3 className="text-white text-lg font-light mb-4 uppercase tracking-wider border-b border-gray-600 pb-2" style={{ fontFamily: "'Playfair Display', serif" }}>How Did You Hear About Us</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelStyle}>Select Source</label>
                  <GlassDropdown
                    name="hearAboutUs"
                    value={formData.hearAboutUs}
                    onChange={handleInputChange}
                    placeholder="Select Option"
                    options={["Website", "Online Portal", "Newspaper", "Hoarding", "Email / SMS", "Direct Walk in", "Event Exhibition", "Channel Partner", "Others"]}
                  />
                </div>

                {formData.hearAboutUs === 'Channel Partner' && (
                  <div className="md:col-span-2">
                    <h3 className="text-white text-lg font-light mb-4 uppercase tracking-wider border-b border-gray-600 pb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Channel Partner Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelStyle}>Company Name</label>
                        <input type="text" name="channelPartnerCompany" value={formData.channelPartnerCompany} onChange={handleInputChange} placeholder="Enter company name" className={inputStyle} />
                      </div>
                      <div>
                        <label className={labelStyle}>CP Name</label>
                        <input type="text" name="channelPartnerName" value={formData.channelPartnerName} onChange={handleInputChange} placeholder="Enter CP name" className={inputStyle} />
                      </div>
                      <div>
                        <label className={labelStyle}>Mobile No.</label>
                        <input type="text" name="channelPartnerMobile" value={formData.channelPartnerMobile} onChange={handleInputChange} onBlur={handleBlur} placeholder="Enter mobile number" className={inputStyle} maxLength="10" />
                        {errors.channelPartnerMobile && touched.channelPartnerMobile && <p className="text-red-400 text-xs mt-1">{errors.channelPartnerMobile}</p>}
                      </div>
                      <div>
                        <label className={labelStyle}>RERA No.</label>
                        <input type="text" name="channelPartnerRERA" value={formData.channelPartnerRERA} onChange={handleInputChange} placeholder="Enter RERA number" className={inputStyle} />
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelStyle}>Email Id.</label>
                        <input type="email" name="channelPartnerEmail" value={formData.channelPartnerEmail} onChange={handleInputChange} placeholder="Enter email address" className={inputStyle} />
                      </div>
                    </div>
                  </div>
                )}

                {formData.hearAboutUs === "Others" && (
                  <div>
                    <label className={labelStyle}>Please Specify</label>
                    <textarea name="referenceDetails" value={formData.referenceDetails || ""} onChange={handleInputChange} placeholder="Enter details..." className={inputStyle} />
                  </div>
                )}
              </div>
            </div>

            {/* Lead Owner — from DB */}
            <div>
              <h3 className="text-white text-lg font-light mb-4 uppercase tracking-wider border-b border-gray-600 pb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Assignment</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelStyle}>Lead Owner <span className="text-red-400">*</span></label>
                  {loadingDropdowns ? (
                    <div className={`${inputStyle} flex items-center gap-2 text-gray-400`}>
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                    </div>
                  ) : (
                    <GlassDropdown
                      name="leadOwner"
                      value={formData.leadOwner}
                      onChange={(e) => { handleInputChange(e); handleBlur(e); }}
                      placeholder="Select Lead Owner"
                      options={users.map(u => getUserLabel(u))}
                    />
                  )}
                  {errors.leadOwner && touched.leadOwner && <p className="text-red-400 text-xs mt-1">{errors.leadOwner}</p>}
                </div>
              </div>
            </div>

            <button onClick={handleInitialSubmit} disabled={loading || loadingDropdowns}
              className="w-full md:w-auto md:mx-auto md:block mt-6 bg-gradient-to-r from-gray-200 to-gray-400 text-black font-bold py-3 px-12 rounded-full hover:scale-105 active:scale-95 transition-transform duration-200 shadow-xl uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Sending OTP...</> : 'Submit & Verify'}
            </button>
          </div>
        )}

        {/* ── STEP 2: OTP ── */}
        {step === 2 && (
          <div className="max-w-md mx-auto text-center otp-section">
            <div className="mb-6">
              <div className="w-20 h-20 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                <Phone className="w-10 h-10 text-gray-300" />
              </div>
              <h2 className="text-2xl text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Verify Your Number</h2>
              <p className="text-gray-400">We've sent a 6-digit code to<br /><span className="text-white font-semibold">+91 {formData.mobileNumber}</span></p>
            </div>
            <div className="mb-6">
              <label className={labelStyle}>Enter OTP</label>
              <input type="text" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" className={`${inputStyle} text-center text-2xl tracking-widest`} maxLength="6" autoFocus />
            </div>
            <button onClick={verifyOtpAndSubmit} disabled={loading || otp.length !== 6}
              className="w-full bg-gradient-to-r from-gray-200 to-gray-400 text-black font-bold py-4 rounded-full hover:scale-105 active:scale-95 transition-transform duration-200 shadow-xl uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" />Verifying...</> : 'Verify & Submit'}
            </button>
            <button onClick={resendOTP} disabled={loading} className="mt-4 text-gray-400 hover:text-white transition-colors text-sm underline">
              Didn't receive code? Resend OTP
            </button>
          </div>
        )}

        {/* ── STEP 3: Success ── */}
        {step === 3 && (
          <div className="max-w-md mx-auto text-center">
            <div className="mb-6">
              <div className="w-24 h-24 mx-auto mb-4 bg-green-500 bg-opacity-20 rounded-full flex items-center justify-center">
                <CheckCircle className="w-16 h-16 text-green-400" />
              </div>
              <h2 className="text-3xl text-white mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>Thank You!</h2>
              <p className="text-gray-300 text-lg leading-relaxed">Your inquiry has been successfully submitted.<br />Our team will contact you shortly.</p>
            </div>
            <div className="bg-black bg-opacity-30 rounded-xl p-6 mb-6 text-left">
              <h3 className="text-gray-400 text-sm uppercase tracking-wide mb-3">Your Details</h3>
              <div className="space-y-2 text-white">
                <p><span className="text-gray-400">Name:</span> {formData.fullName}</p>
                <p><span className="text-gray-400">Email:</span> {formData.email}</p>
                <p><span className="text-gray-400">Mobile:</span> +91 {formData.mobileNumber}</p>
                <p><span className="text-gray-400">Address:</span> {formData.address}, {formData.city} - {formData.pinCode}</p>
                <p><span className="text-gray-400">Property:</span> {formData.propertyType}</p>
                <p><span className="text-gray-400">Budget:</span> {formData.budgetRange}</p>
                <p><span className="text-gray-400">Lead Owner:</span> {formData.leadOwner}</p>
              </div>
            </div>
            <button onClick={resetForm} className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white font-bold py-3 rounded-full hover:scale-105 transition-transform duration-200">
              Submit Another Inquiry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadForm;
