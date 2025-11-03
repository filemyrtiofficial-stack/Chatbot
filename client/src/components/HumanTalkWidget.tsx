import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const HumanTalkWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedPhone, setSubmittedPhone] = useState('');
  const phoneInputRef = useRef<HTMLInputElement>(null);

  // Company phone number - update this with your actual number
  const companyPhoneNumber = '+91 99999 99999';

  // Focus phone input when modal opens
  useEffect(() => {
    if (isOpen && phoneInputRef.current && !isSubmitted) {
      setTimeout(() => phoneInputRef.current?.focus(), 100);
    }
  }, [isOpen, isSubmitted]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (phoneNumber.trim() === '' || query.trim() === '') {
      return;
    }

    setIsSubmitting(true);
    const submittedPhoneValue = phoneNumber.trim();

    // Simulate API call (you can replace this with actual API call later)
    setTimeout(() => {
      console.log('Submitted:', { phoneNumber: submittedPhoneValue, query });
      setIsSubmitting(false);
      setIsSubmitted(true);
      setSubmittedPhone(submittedPhoneValue);
      setPhoneNumber('');
      setQuery('');

      // Reset success message after 3 seconds
      setTimeout(() => {
        setIsSubmitted(false);
        setSubmittedPhone('');
        setIsOpen(false);
      }, 3000);
    }, 1000);
  };

  return (
    <>
      {/* Floating Button */}
      <motion.div
        className="fixed bottom-6 right-6 z-50"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        {/* Tooltip */}
        <AnimatePresence>
          {isHovered && !isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-full right-0 mb-3 w-64 rounded-lg bg-slate-900 px-4 py-3 text-white shadow-xl"
            >
              <div className="text-sm font-semibold">
                HumanTalk <span className="text-red-400">(Beta)</span>
              </div>
              <div className="mt-1 text-xs text-gray-300">
                👥 Talk with a Real Human Expert! Click to connect with our team and get personalized assistance right away.
              </div>
              {/* Arrow pointing down */}
              <div className="absolute bottom-0 right-6 translate-y-full">
                <div className="h-0 w-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-slate-900"></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Button */}
        <motion.button
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="relative flex items-center gap-2 rounded-xl bg-[#1660a6] px-5 py-3 shadow-lg transition-shadow hover:bg-[#145891] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#1660a6] focus:ring-offset-2"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Talk with a Human Expert"
        >
          {/* Human/Chat Icon */}
          <svg
            className="h-5 w-5 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
            />
          </svg>

          {/* Text */}
          <span className="text-sm font-semibold text-white">Talk with Human</span>

          {/* Beta Badge */}
          <div className="absolute -top-1.5 -right-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white shadow-md">
            Beta
          </div>
        </motion.button>

      </motion.div>

      {/* Chat Modal */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => {
                setIsOpen(false);
                setIsSubmitted(false);
                setPhoneNumber('');
                setQuery('');
                setSubmittedPhone('');
              }}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-24 right-6 z-50 flex h-auto max-h-[600px] w-[400px] flex-col rounded-2xl bg-white shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-200 bg-[#1660a6] px-5 py-4 text-white">
                <div className="flex items-center gap-2">
                  <span className="text-xl">👥</span>
                  <div>
                    <h2 className="text-lg font-semibold">Talk with a Human</h2>
                    <p className="text-xs text-blue-100">Contact us for assistance</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setIsSubmitted(false);
                    setPhoneNumber('');
                    setQuery('');
                    setSubmittedPhone('');
                  }}
                  className="rounded-full p-1 transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#1660a6]"
                  aria-label="Close form"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto px-5 py-6">
                {isSubmitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex h-full flex-col items-center justify-center text-center"
                  >
                    <div className="mb-4 rounded-full bg-green-100 p-4">
                      <svg
                        className="h-12 w-12 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <h3 className="mb-2 text-lg font-semibold text-slate-900">Thank You!</h3>
                    <p className="text-sm text-slate-600">
                      Your query has been received. We'll contact you soon at{' '}
                      <span className="font-semibold">{submittedPhone}</span>
                    </p>
                  </motion.div>
                ) : (
                  <>
                    {/* Company Phone Number */}
                    <div className="mb-6 rounded-xl bg-slate-50 p-4 text-center">
                      <p className="mb-2 text-xs font-medium text-slate-600">Our Contact Number</p>
                      <a
                        href={`tel:${companyPhoneNumber.replace(/\s/g, '')}`}
                        className="flex items-center justify-center gap-2 text-xl font-bold text-[#1660a6] transition-colors hover:text-[#145891]"
                      >
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                          />
                        </svg>
                        <span>{companyPhoneNumber}</span>
                      </a>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {/* Phone Number Input */}
                      <div>
                        <label
                          htmlFor="phone"
                          className="mb-2 block text-sm font-medium text-slate-700"
                        >
                          Your Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                          ref={phoneInputRef}
                          id="phone"
                          type="tel"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="Enter your phone number"
                          required
                          className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm focus:border-[#1660a6] focus:outline-none focus:ring-2 focus:ring-[#1660a6]/20 focus:ring-offset-1"
                        />
                      </div>

                      {/* Query Input */}
                      <div>
                        <label
                          htmlFor="query"
                          className="mb-2 block text-sm font-medium text-slate-700"
                        >
                          Your Query <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          id="query"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Describe your question or issue..."
                          required
                          rows={4}
                          className="w-full resize-none rounded-lg border border-slate-300 px-4 py-3 text-sm focus:border-[#1660a6] focus:outline-none focus:ring-2 focus:ring-[#1660a6]/20 focus:ring-offset-1"
                        />
                      </div>

                      {/* Submit Button */}
                      <motion.button
                        type="submit"
                        disabled={phoneNumber.trim() === '' || query.trim() === '' || isSubmitting}
                        whileHover={{ scale: phoneNumber.trim() && query.trim() ? 1.02 : 1 }}
                        whileTap={{ scale: phoneNumber.trim() && query.trim() ? 0.98 : 1 }}
                        className="w-full rounded-lg bg-[#1660a6] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:bg-[#145891] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#1660a6] focus:ring-offset-1"
                      >
                        {isSubmitting ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg
                              className="h-4 w-4 animate-spin"
                              fill="none"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            Submitting...
                          </span>
                        ) : (
                          'Submit Query'
                        )}
                      </motion.button>
                    </form>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default HumanTalkWidget;

