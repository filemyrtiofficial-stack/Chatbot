import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHumanTalk } from '../App';
import { api, resolveApiUrl } from '../api';

const HumanTalkWidget: React.FC = () => {
  const { isOpen, setIsOpen } = useHumanTalk();
  const [isHovered, setIsHovered] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedPhone, setSubmittedPhone] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; query?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const queryInputRef = useRef<HTMLTextAreaElement>(null);

  // Company phone number - update this with your actual number
  const companyPhoneNumber = '+91 99999 99999';
  const MAX_QUERY_LENGTH = 1000;

  // Format phone number as user types (Indian format)
  const formatPhoneNumber = (value: string): string => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');

    // Format for Indian numbers
    if (digits.length === 0) return '';
    if (digits.length <= 2) return `+91 ${digits}`;
    if (digits.length <= 7) return `+91 ${digits.slice(2, 7)}`;
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7, 11)}`;
  };

  // Validate phone number
  const validatePhone = (phone: string): string | undefined => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      return 'Phone number must be at least 10 digits';
    }
    if (digits.length > 13) {
      return 'Phone number is too long';
    }
    return undefined;
  };

  // Validate query
  const validateQuery = (text: string): string | undefined => {
    if (text.trim().length < 10) {
      return 'Please provide more details (at least 10 characters)';
    }
    if (text.length > MAX_QUERY_LENGTH) {
      return `Query cannot exceed ${MAX_QUERY_LENGTH} characters`;
    }
    return undefined;
  };

  // Handle phone number change
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhoneNumber(formatted);
    if (errors.phone) {
      const error = validatePhone(formatted);
      setErrors((prev: { phone?: string; query?: string }) => ({ ...prev, phone: error }));
    }
    setSubmitError(null);
  };

  // Handle query change
  const handleQueryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_QUERY_LENGTH) {
      setQuery(value);
      if (errors.query) {
        const error = validateQuery(value);
        setErrors((prev: { phone?: string; query?: string }) => ({ ...prev, query: error }));
      }
      setSubmitError(null);
    }
  };

  // Focus phone input when modal opens
  useEffect(() => {
    if (isOpen && phoneInputRef.current && !isSubmitted) {
      setTimeout(() => phoneInputRef.current?.focus(), 150);
    }
  }, [isOpen, isSubmitted]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setPhoneNumber('');
        setQuery('');
        setErrors({});
        setSubmitError(null);
        setIsSubmitted(false);
      }, 300);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Validate both fields
    const phoneError = validatePhone(phoneNumber);
    const queryError = validateQuery(query);

    if (phoneError || queryError) {
      setErrors({
        phone: phoneError,
        query: queryError,
      });

      // Focus on first error field
      if (phoneError && phoneInputRef.current) {
        phoneInputRef.current.focus();
      } else if (queryError && queryInputRef.current) {
        queryInputRef.current.focus();
      }
      return;
    }

    setIsSubmitting(true);
    const submittedPhoneValue = phoneNumber.trim();
    const submittedQuery = query.trim();

    try {
      // Call the API to submit the form and send WhatsApp notification
      await api('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          phoneNumber: submittedPhoneValue,
          query: submittedQuery,
        }),
      });

      setIsSubmitting(false);
      setIsSubmitted(true);
      setSubmittedPhone(submittedPhoneValue);
      setErrors({});
    } catch (error) {
      console.error('Error submitting form:', error);
      setIsSubmitting(false);
      setSubmitError('Failed to submit your query. Please check your connection and try again.');

      // Scroll to error message
      setTimeout(() => {
        const errorElement = document.querySelector('[data-error-message]');
        errorElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
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
              className="absolute bottom-full right-0 mb-3 w-64 rounded-lg bg-white px-4 py-3 text-black shadow-xl border border-gray-200"
            >
              <div className="text-sm font-semibold text-black">
                Need Help? Talk to a Real Person <span className="text-red-600">(Beta)</span>
              </div>
              <div className="mt-1 text-xs text-gray-700">
                👥 Talk with a Real Human Expert! Click to connect with our team and get personalized assistance right away.
              </div>
              {/* Arrow pointing down */}
              <div className="absolute bottom-0 right-6 translate-y-full">
                <div className="h-0 w-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white"></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Button */}
        <motion.button
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="relative flex items-center gap-2.5 rounded-xl bg-[#026CB6] px-5 py-3.5 shadow-lg transition-all hover:shadow-xl hover:shadow-[#026CB6]/25 focus:outline-none focus:ring-2 focus:ring-[#026CB6] focus:ring-offset-2"
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
              strokeWidth={2.5}
              d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
            />
          </svg>

          {/* Text */}
          <span className="text-sm font-semibold text-white">Need Help? Talk to a Real Person</span>

          {/* Beta Badge */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-red-600 px-2 py-0.5 text-[9px] font-bold uppercase text-white shadow-lg ring-2 ring-white"
          >
            Beta
          </motion.div>
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
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed z-50 flex flex-col bg-white shadow-2xl md:top-6 md:right-6 md:bottom-6 md:left-auto md:h-auto md:max-h-[calc(100vh-3rem)] md:w-[440px] md:rounded-2xl bottom-0 right-0 left-0 w-full max-h-[calc(100vh-3rem)] rounded-t-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="human-talk-title"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-blue-700/30 bg-[#026CB6] px-6 py-5 text-white shadow-md">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                    <span className="text-xl">👥</span>
                  </div>
                  <div>
                    <h2 id="human-talk-title" className="text-lg font-semibold leading-tight">
                      Talk with a Human
                    </h2>
                    <p className="text-xs text-blue-100/90 mt-0.5">Get personalized assistance</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-full p-1.5 transition-all hover:bg-white/20 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-transparent"
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
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {isSubmitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    className="flex min-h-[400px] flex-col items-center justify-center text-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                      className="mb-6 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 p-5 shadow-lg"
                    >
                      <svg
                        className="h-14 w-14 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <motion.path
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ delay: 0.3, duration: 0.5 }}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </motion.div>
                    <motion.h3
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="mb-4 text-2xl font-bold text-slate-900"
                    >
                      Thank You!
                    </motion.h3>
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="space-y-3 text-sm leading-relaxed text-slate-600 max-w-sm"
                    >
                      <p>
                        Your query has been successfully submitted. We've received your message and our team will get back to you soon.
                      </p>
                      <p className="pt-2 border-t border-slate-200">
                        We'll contact you at{' '}
                        <span className="font-semibold text-[#026CB6]">{submittedPhone}</span> regarding your inquiry.
                      </p>
                      <p className="mt-4 text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                        <span className="font-semibold text-slate-700">⏱️ Response Time:</span> Typically within 24 hours. For urgent matters, please call us or reach out via WhatsApp.
                      </p>
                    </motion.div>
                    <motion.button
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 }}
                      onClick={() => setIsOpen(false)}
                      className="mt-6 rounded-lg bg-[#026CB6] px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#0259a3] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#026CB6] focus:ring-offset-2"
                    >
                      Close
                    </motion.button>
                  </motion.div>
                ) : (
                  <>
                    {/* Error Message */}
                    <AnimatePresence>
                      {submitError && (
                        <motion.div
                          initial={{ opacity: 0, y: -10, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: 'auto' }}
                          exit={{ opacity: 0, y: -10, height: 0 }}
                          data-error-message
                          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3"
                        >
                          <div className="flex items-start gap-2">
                            <svg
                              className="h-5 w-5 flex-shrink-0 text-red-600 mt-0.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <p className="text-sm text-red-800">{submitError}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Company Phone Number */}
                    <div className="mb-6 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/30 p-5 shadow-sm">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 text-center">
                        📞 Direct Contact
                      </p>
                      <div className="flex flex-col gap-3">
                        {/* Phone Number */}
                        <a
                          href={`tel:${companyPhoneNumber.replace(/\s/g, '')}`}
                          className="group flex items-center justify-center gap-2.5 rounded-lg bg-white px-4 py-3 text-lg font-bold text-[#026CB6] transition-all hover:bg-[#026CB6] hover:text-white hover:shadow-md"
                        >
                          <svg
                            className="h-5 w-5 transition-transform group-hover:scale-110"
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
                          className="group flex items-center justify-center gap-2.5 rounded-lg bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[#20BA5A] hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
                        >
                          <svg
                            className="h-5 w-5 transition-transform group-hover:scale-110"
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
                    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                      {/* Phone Number Input */}
                      <div>
                        <label
                          htmlFor="phone"
                          className="mb-2 block text-sm font-semibold text-slate-700"
                        >
                          Your Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                          ref={phoneInputRef}
                          id="phone"
                          name="phone"
                          type="tel"
                          value={phoneNumber}
                          onChange={handlePhoneChange}
                          onBlur={() => {
                            const error = validatePhone(phoneNumber);
                            setErrors((prev: { phone?: string; query?: string }) => ({ ...prev, phone: error }));
                          }}
                          placeholder="+91 12345 67890"
                          required
                          aria-invalid={!!errors.phone}
                          aria-describedby={errors.phone ? 'phone-error' : undefined}
                          className={`w-full rounded-lg border px-4 py-3 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 ${errors.phone
                            ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/20'
                            : 'border-slate-300 bg-white focus:border-[#026CB6] focus:ring-[#026CB6]/20'
                            }`}
                        />
                        <AnimatePresence>
                          {errors.phone && (
                            <motion.p
                              initial={{ opacity: 0, y: -5, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: 'auto' }}
                              exit={{ opacity: 0, y: -5, height: 0 }}
                              id="phone-error"
                              className="mt-1.5 text-xs text-red-600 flex items-center gap-1"
                              role="alert"
                            >
                              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              {errors.phone}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Query Input */}
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <label
                            htmlFor="query"
                            className="block text-sm font-semibold text-slate-700"
                          >
                            Your Query <span className="text-red-500">*</span>
                          </label>
                          <span
                            className={`text-xs font-medium ${query.length > MAX_QUERY_LENGTH * 0.9
                              ? 'text-orange-600'
                              : 'text-slate-400'
                              }`}
                          >
                            {query.length}/{MAX_QUERY_LENGTH}
                          </span>
                        </div>
                        <textarea
                          ref={queryInputRef}
                          id="query"
                          name="query"
                          value={query}
                          onChange={handleQueryChange}
                          onBlur={() => {
                            const error = validateQuery(query);
                            setErrors((prev: { phone?: string; query?: string }) => ({ ...prev, query: error }));
                          }}
                          placeholder="Describe your question or issue in detail..."
                          required
                          rows={5}
                          aria-invalid={!!errors.query}
                          aria-describedby={errors.query ? 'query-error' : undefined}
                          className={`w-full resize-none rounded-lg border px-4 py-3 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 ${errors.query
                            ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/20'
                            : 'border-slate-300 bg-white focus:border-[#026CB6] focus:ring-[#026CB6]/20'
                            }`}
                        />
                        <AnimatePresence>
                          {errors.query && (
                            <motion.p
                              initial={{ opacity: 0, y: -5, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: 'auto' }}
                              exit={{ opacity: 0, y: -5, height: 0 }}
                              id="query-error"
                              className="mt-1.5 text-xs text-red-600 flex items-center gap-1"
                              role="alert"
                            >
                              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              {errors.query}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Submit Button */}
                      <motion.button
                        type="submit"
                        disabled={
                          phoneNumber.trim() === '' ||
                          query.trim() === '' ||
                          isSubmitting ||
                          !!errors.phone ||
                          !!errors.query
                        }
                        whileHover={{
                          scale:
                            phoneNumber.trim() && query.trim() && !errors.phone && !errors.query && !isSubmitting
                              ? 1.02
                              : 1,
                        }}
                        whileTap={{
                          scale:
                            phoneNumber.trim() && query.trim() && !errors.phone && !errors.query && !isSubmitting
                              ? 0.98
                              : 1,
                        }}
                        className="w-full rounded-lg bg-[#026CB6] px-5 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-[#026CB6] focus:ring-offset-2"
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
                          <span className="flex items-center justify-center gap-2">
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                              />
                            </svg>
                            Submit Query
                          </span>
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
      className="md:hidden relative flex items-center gap-1 rounded-lg bg-[#026CB6] px-1.5 py-1.5 text-[10px] sm:text-[11px] font-semibold text-white transition-colors hover:bg-[#0259a3] focus:outline-none focus:ring-2 focus:ring-[#026CB6] focus:ring-offset-1 whitespace-nowrap shadow-sm flex-shrink-0"
      aria-label="Need Help? Talk to a Real Person"
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
      <span className="inline whitespace-nowrap">Need Help? Talk to a Real Person</span>
      <div className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1 py-0.5 text-[8px] font-bold uppercase text-white shadow-sm">
        Beta
      </div>
    </button>
  );
};

