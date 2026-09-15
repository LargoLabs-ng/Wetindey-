'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronDown, CheckCircle2, Share2, QrCode } from 'lucide-react';
import { appHost, SUPPORT_EMAIL } from '@/lib/app-url';

const LandingPage = () => {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const faqItems = [
    {
      q: "Do I need an app to scan tickets?",
      a: "No. The scanner opens in any phone browser. Works on the cheapest Android in the room."
    },
    {
      q: "What if there's no internet at my venue?",
      a: "Your QR codes work offline. Download the check-in list before the event, and scan without connectivity."
    },
    {
      q: "Can I sell free tickets?",
      a: "Yes. Free, paid, VIP — mix and match however you want."
    },
    {
      q: "How fast do I get paid?",
      a: "Payouts settle within 24 hours to your bank account via Paystack."
    },
    {
      q: "How do my buyers pay?",
      a: "Bank transfer through Paystack. Fast, secure, and trackable."
    },
    {
      q: "Can I record cash sales from the door?",
      a: "Yes. Add cash tickets manually from your dashboard, and track everything in one place."
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-forest via-forest-deep to-forest">
      {/* Header/Navigation */}
      <header className="sticky top-0 z-50 bg-forest/95 backdrop-blur border-b border-forest-mid/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10">
                <Image
                  src="/logo-reversed.png"
                  alt="Wetin Dey"
                  width={40}
                  height={40}
                  className="w-full h-full"
                />
              </div>
              <span className="text-ivory font-semibold hidden sm:inline">Wetin Dey?</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              <a href="#how-it-works" className="text-sage hover:text-ivory transition-colors text-sm">
                How it works
              </a>
              <a href="#organizers" className="text-sage hover:text-ivory transition-colors text-sm">
                For organizers
              </a>
              <a href="#attendees" className="text-sage hover:text-ivory transition-colors text-sm">
                For attendees
              </a>
            </nav>

            {/* Auth Links */}
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sage hover:text-ivory transition-colors text-sm font-medium"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 bg-sage hover:bg-sage-light text-forest rounded-lg font-medium text-sm transition-colors"
              >
                Sign up
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="text-center mb-12">
          <p className="text-sage font-semibold text-sm uppercase tracking-wider mb-4">
            Your plug for what's happening
          </p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ivory mb-6 leading-tight">
            Wetin dey{' '}
            <span className="text-purple-lift">this weekend?</span>
          </h1>
          <p className="text-lg md:text-xl text-sage max-w-2xl mx-auto mb-8">
            Create your event, share your link, and start selling tickets. Every buyer gets a secure QR ticket, making payments, entry, and check-in simple for everyone.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 bg-sage hover:bg-sage-light text-forest font-semibold rounded-lg transition-colors text-lg"
          >
            Create your event
          </Link>
        </div>
      </section>

      {/* Stats Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 border-y border-forest-mid/30">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-sage mb-2">0</div>
            <p className="text-sage/60 text-sm">Events hosted</p>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-sage mb-2">0</div>
            <p className="text-sage/60 text-sm">Tickets issued</p>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-sage mb-2">0</div>
            <p className="text-sage/60 text-sm">Organizers</p>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-sage mb-2">100%</div>
            <p className="text-sage/60 text-sm">Secure</p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <p className="text-sage font-semibold text-sm uppercase tracking-wider mb-4">
            The process
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-ivory mb-4">
            Three steps. No spreadsheets.
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-12">
          {/* Create */}
          <div className="bg-forest-deep/50 border border-forest-mid/30 rounded-xl p-8 hover:border-sage/50 transition-colors">
            <div className="w-12 h-12 bg-sage/20 rounded-lg flex items-center justify-center mb-6">
              <CheckCircle2 className="w-6 h-6 text-sage" />
            </div>
            <h3 className="text-xl font-bold text-ivory mb-3">Create</h3>
            <p className="text-sage">
              Set your event name, date, venue, and ticket tiers. Free tickets, paid tiers, VIP — however you want to organize it.
            </p>
          </div>

          {/* Share */}
          <div className="bg-forest-deep/50 border border-forest-mid/30 rounded-xl p-8 hover:border-sage/50 transition-colors">
            <div className="w-12 h-12 bg-sage/20 rounded-lg flex items-center justify-center mb-6">
              <Share2 className="w-6 h-6 text-sage" />
            </div>
            <h3 className="text-xl font-bold text-ivory mb-3">Share</h3>
            <p className="text-sage">
              The moment you publish, you get one link: {appHost()}/e/your-event. Drop it on WhatsApp, Instagram, Twitter.
            </p>
          </div>

          {/* Scan */}
          <div className="bg-forest-deep/50 border border-forest-mid/30 rounded-xl p-8 hover:border-sage/50 transition-colors">
            <div className="w-12 h-12 bg-sage/20 rounded-lg flex items-center justify-center mb-6">
              <QrCode className="w-6 h-6 text-sage" />
            </div>
            <h3 className="text-xl font-bold text-ivory mb-3">Scan</h3>
            <p className="text-sage">
              Attendees show their QR code at the door. Gate staff scan, ticket is marked used, and you have a real-time headcount.
            </p>
          </div>
        </div>
      </section>

      {/* For Organizers */}
      <section id="organizers" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-sage font-semibold text-sm uppercase tracking-wider mb-4">
              Organizer dashboard
            </p>
            <h2 className="text-4xl md:text-5xl font-bold text-ivory mb-8">
              Everything you need to run the door, in one dashboard.
            </h2>

            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="w-2 h-2 bg-sage rounded-full mt-2 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-bold text-ivory mb-2">Real-time sales</h3>
                  <p className="text-sage">
                    Watch tickets sell as they happen, broken down by tier and payment method.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-2 h-2 bg-sage rounded-full mt-2 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-bold text-ivory mb-2">Your own link</h3>
                  <p className="text-sage">
                    One URL per event, brandable, shareable, and tracked for you.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-2 h-2 bg-sage rounded-full mt-2 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-bold text-ivory mb-2">Team access</h3>
                  <p className="text-sage">
                    Invite gate staff with scan-only access. They see tickets, not your revenue.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-2 h-2 bg-sage rounded-full mt-2 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-bold text-ivory mb-2">Payouts you can track</h3>
                  <p className="text-sage">
                    See exactly what's pending and when it lands in your account.
                  </p>
                </div>
              </div>
            </div>

            <Link
              href="/signup"
              className="inline-block mt-8 px-8 py-4 bg-sage hover:bg-sage-light text-forest font-semibold rounded-lg transition-colors"
            >
              Start selling in less than 5 minutes
            </Link>
          </div>

          {/* Placeholder for dashboard image */}
          <div className="bg-gradient-to-br from-forest-deep to-forest-mid rounded-xl border border-forest-mid/30 h-80 flex items-center justify-center">
            <div className="text-center">
              <div className="text-sage/30 text-6xl mb-4">📊</div>
              <p className="text-sage/50">Dashboard preview</p>
            </div>
          </div>
        </div>
      </section>

      {/* For Attendees */}
      <section id="attendees" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="bg-gradient-to-r from-forest-deep/50 to-sage/10 border border-forest-mid/30 rounded-2xl p-12">
          <p className="text-sage font-semibold text-sm uppercase tracking-wider mb-4">
            Attendee experience
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-ivory mb-6">
            Buy once. Show up. That's it.
          </h2>
          <p className="text-lg text-sage/80 mb-12 max-w-2xl">
            Pick your ticket, pay by bank transfer, and it lands in your inbox with a QR code that's yours alone. No app needed. No extra steps.
          </p>

          <div className="grid sm:grid-cols-2 gap-8">
            <div className="bg-forest-deep/50 border border-forest-mid/30 rounded-lg p-6">
              <p className="text-sage font-semibold mb-2">💳 Bank transfer</p>
              <p className="text-sage/70">Fast, secure payments via Paystack</p>
            </div>
            <div className="bg-forest-deep/50 border border-forest-mid/30 rounded-lg p-6">
              <p className="text-sage font-semibold mb-2">💵 Cash at the door</p>
              <p className="text-sage/70">Manual entry and tracking included</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <p className="text-sage font-semibold text-sm uppercase tracking-wider mb-4">
            Questions
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-ivory">
            Frequently asked questions
          </h2>
        </div>

        <div className="space-y-4">
          {faqItems.map((item, idx) => (
            <div
              key={idx}
              className="bg-forest-deep/50 border border-forest-mid/30 rounded-lg overflow-hidden hover:border-sage/50 transition-colors"
            >
              <button
                onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-forest-mid/20 transition-colors"
              >
                <h3 className="text-ivory font-semibold text-left">{item.q}</h3>
                <ChevronDown
                  className={`w-5 h-5 text-sage transition-transform flex-shrink-0 ml-4 ${
                    expandedFaq === idx ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {expandedFaq === idx && (
                <div className="px-6 py-4 bg-forest-mid/20 border-t border-forest-mid/30">
                  <p className="text-sage/80">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-ivory mb-8">
          Your next event doesn't need a spreadsheet.
        </h2>
        <Link
          href="/signup"
          className="inline-block px-8 py-4 bg-sage hover:bg-sage-light text-forest font-semibold rounded-lg transition-colors text-lg"
        >
          Create your event
        </Link>
      </section>

      {/* Footer */}
      <footer className="bg-forest border-t border-forest-mid/30 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10">
                  <Image
                    src="/logo-reversed.png"
                    alt="Wetin Dey"
                    width={40}
                    height={40}
                    className="w-full h-full"
                  />
                </div>
                <span className="text-ivory font-semibold">Wetin Dey?</span>
              </div>
              <p className="text-sage/60 text-sm">Events made simple</p>
              <div className="flex gap-4 mt-6">
                <a href="#" className="text-sage/50 hover:text-sage transition-colors">
                  Twitter
                </a>
                <a href="#" className="text-sage/50 hover:text-sage transition-colors">
                  Instagram
                </a>
              </div>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-ivory font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#how-it-works" className="text-sage/60 hover:text-sage transition-colors">
                    How it works
                  </a>
                </li>
                <li>
                  <a href="#organizers" className="text-sage/60 hover:text-sage transition-colors">
                    For organizers
                  </a>
                </li>
                <li>
                  <a href="#attendees" className="text-sage/60 hover:text-sage transition-colors">
                    For attendees
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-ivory font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="text-sage/60 hover:text-sage transition-colors">
                    Terms
                  </a>
                </li>
                <li>
                  <a href="#" className="text-sage/60 hover:text-sage transition-colors">
                    Privacy
                  </a>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-ivory font-semibold mb-4">Contact</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="text-sage/60 hover:text-sage transition-colors"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </li>
                <li className="text-sage/60">+234 (0) XXX XXX XXXX</li>
                <li className="text-sage/60">Lagos, Nigeria</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-forest-mid/30 pt-8">
            <p className="text-sage/60 text-sm text-center">
              © 2026 Wetin Dey. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
