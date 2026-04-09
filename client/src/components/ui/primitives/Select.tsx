import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useTheme } from "../../../contexts/ThemeContext";
import { ChevronUpDownIcon } from "@heroicons/react/20/solid";
import { AnimatePresence, motion } from "framer-motion";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  className = "",
  id,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const index = options.findIndex((opt) => opt.value === value);
      setFocusedIndex(index >= 0 ? index : 0);
    }
  }, [isOpen, value, options]);

  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listboxRef.current) {
      const optionElement = listboxRef.current.children[
        focusedIndex
      ] as HTMLElement;
      if (optionElement) {
        optionElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex, isOpen]);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (option: SelectOption) => {
    if (!option.disabled) {
      onChange(option.value);
      setIsOpen(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen) {
          if (focusedIndex >= 0 && !options[focusedIndex].disabled) {
            handleSelect(options[focusedIndex]);
          }
        } else {
          setIsOpen(true);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex((prev) =>
            prev < options.length - 1 ? prev + 1 : prev,
          );
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        }
        break;
    }
  };

  return (
    <div
      className={`relative w-full ${className}`}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={handleToggle}
        className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors duration-200 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 ${
          isDark
            ? "border-gray-600/80 bg-gray-800/60 text-white"
            : "border-gray-200/60 bg-white text-gray-900 shadow-subtle"
        } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="block truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronUpDownIcon
          className={`h-5 w-5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={`absolute left-0 right-0 z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border py-1 text-sm outline-none ${
              isDark
                ? "border-gray-700/60 bg-gray-800"
                : "border-gray-200/60 bg-white shadow-elevated"
            }`}
            role="listbox"
            ref={listboxRef}
          >
            {options.length === 0 ? (
              <div
                className={`px-3.5 py-2 text-center ${
                  isDark ? "text-gray-400" : "text-gray-500"
                }`}
              >
                No options
              </div>
            ) : (
              options.map((option, index) => {
                const isSelected = option.value === value;
                const isFocused = index === focusedIndex;

                let optionClasses =
                  "relative cursor-pointer select-none px-3.5 py-2 transition-colors duration-200";

                if (option.disabled) {
                  optionClasses += isDark
                    ? " text-gray-500 cursor-not-allowed"
                    : " text-gray-400 cursor-not-allowed";
                } else if (isSelected) {
                  optionClasses += isDark
                    ? " bg-blue-500/10 text-blue-400"
                    : " bg-blue-50 text-blue-600";
                } else {
                  optionClasses += isDark ? " text-gray-200" : " text-gray-900";
                  if (isFocused) {
                    optionClasses += isDark ? " bg-gray-700/50" : " bg-gray-50";
                  }
                }

                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    className={optionClasses}
                    onClick={() => handleSelect(option)}
                    onMouseEnter={() => {
                      if (!option.disabled) setFocusedIndex(index);
                    }}
                  >
                    <span
                      className={`block truncate ${isSelected ? "font-medium" : "font-normal"}`}
                    >
                      {option.label}
                    </span>
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
