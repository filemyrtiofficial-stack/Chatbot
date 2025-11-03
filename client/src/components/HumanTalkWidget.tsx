import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHumanTalk } from '../App';

const HumanTalkWidget: React.FC = () => {
  const { isOpen, setIsOpen } = useHumanTalk();
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
      // Thank you message will stay until user closes the modal
    }, 1000);
  };

  return (
    <>
      {/* Floating Button - Desktop only */}
      <motion.div
        className="hidden md:block fixed bottom-6 right-6 z-50"
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
              className="fixed z-50 flex flex-col bg-white shadow-2xl md:bottom-24 md:right-6 md:h-auto md:max-h-[600px] md:w-[400px] md:rounded-2xl bottom-0 right-0 left-0 w-full max-h-[calc(100vh-3rem)] rounded-t-2xl"
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
                    <h3 className="mb-3 text-xl font-semibold text-slate-900">Thank You!</h3>
                    <div className="space-y-2 text-sm text-slate-600">
                      <p>
                        Your query has been successfully submitted. We've received your message and our team will get back to you soon.
                      </p>
                      <p>
                        We'll contact you at{' '}
                        <span className="font-semibold text-[#1660a6]">{submittedPhone}</span> regarding your inquiry.
                      </p>
                      <p className="mt-3 text-xs text-slate-500">
                        Our response time is typically within 24 hours. For urgent matters, please feel free to call us or reach out via WhatsApp using the contact information above.
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <>
                    {/* Company Phone Number */}
                    <div className="mb-6 rounded-xl bg-slate-50 p-4">
                      <p className="mb-3 text-xs font-medium text-slate-600 text-center">Our Contact Number</p>
                      <div className="flex flex-col gap-3">
                        {/* Phone Number */}
                        <a
                          href={`tel:${companyPhoneNumber.replace(/\s/g, '')}`}
                          className="flex items-center justify-center gap-2 text-lg font-bold text-[#1660a6] transition-colors hover:text-[#145891]"
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

                        {/* WhatsApp Button */}
                        <a
                          href={`https://wa.me/${companyPhoneNumber.replace(/[^\d]/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#20BA5A] hover:shadow-md"
                        >
                          <svg
                            className="h-5 w-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                          </svg>
                          <span>Chat on WhatsApp</span>
                        </a>
                      </div>
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

// Compact button component for navbar/mobile use
export const HumanTalkNavButton: React.FC = () => {
  const { setIsOpen } = useHumanTalk();
  return (
    <button
      onClick={() => setIsOpen(true)}
      className="md:hidden relative flex items-center gap-1 rounded-lg bg-[#1660a6] px-1.5 py-1.5 text-[10px] sm:text-[11px] font-semibold text-white transition-colors hover:bg-[#145891] focus:outline-none focus:ring-2 focus:ring-[#1660a6] focus:ring-offset-1 whitespace-nowrap shadow-sm flex-shrink-0"
      aria-label="Talk with Human"
    >
      <svg
        className="h-4 w-4 flex-shrink-0"
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
      <span className="inline whitespace-nowrap">Talk With Human</span>
      <div className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1 py-0.5 text-[8px] font-bold uppercase text-white shadow-sm">
        Beta
      </div>
    </button>
  );
};

