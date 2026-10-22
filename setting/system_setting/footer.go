package system_setting

import (
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

const FooterConfigKey = "FooterConfig"

type FooterLink struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	URL      string `json:"url"`
	Group    string `json:"group"`
	Visible  bool   `json:"visible"`
	External bool   `json:"external"`
	Source   string `json:"source"`
}

type FooterConfig struct {
	Version     int          `json:"version"`
	Enabled     bool         `json:"enabled"`
	Layout      string       `json:"layout"`
	Description string       `json:"description"`
	Copyright   string       `json:"copyright"`
	AutoYear    bool         `json:"autoYear"`
	Year        string       `json:"year"`
	Background  string       `json:"background"`
	LegacyMode  string       `json:"legacyMode"`
	Links       []FooterLink `json:"links"`
}

var footerYearPattern = regexp.MustCompile(`^\d{4}(-\d{4})?$`)

// Footer URLs are navigation only. Never accept executable schemes, credentials,
// protocol-relative URLs, or URL-parser ambiguities in administrator input.
func SafeFooterURL(value string, external bool) bool {
	if value == "" {
		return true // An unconfigured link is omitted by the renderer.
	}
	if len(value) > 2048 {
		return false
	}
	decoded := value
	for range 4 {
		if strings.ContainsAny(decoded, "\\\r\n\t") || strings.ContainsFunc(decoded, func(r rune) bool { return r <= 32 || r == 127 }) {
			return false
		}
		if !external && (!strings.HasPrefix(decoded, "/") || strings.HasPrefix(decoded, "//")) {
			return false
		}
		next, err := url.PathUnescape(decoded)
		if err != nil {
			return false
		}
		if next == decoded {
			break
		}
		decoded = next
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.User != nil {
		return false
	}
	if external {
		return (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Hostname() != ""
	}
	return parsed.Scheme == "" && parsed.Host == ""
}

func ValidateFooterConfig(value string) error {
	if value == "" {
		return nil
	} // Legacy installations have no structured option.
	invalid := common.NewMessage("Invalid footer configuration")
	if len(value) > 64*1024 {
		return invalid
	}
	var config FooterConfig
	if common.UnmarshalJsonStr(value, &config) != nil || config.Version != 1 {
		return invalid
	}
	if !slices.Contains([]string{"brand", "developer", "minimal"}, config.Layout) ||
		!slices.Contains([]string{"theme", "muted", "accent"}, config.Background) ||
		!slices.Contains([]string{"replace", "append", "ignore"}, config.LegacyMode) ||
		utf8.RuneCountInString(config.Description) > 500 || utf8.RuneCountInString(config.Copyright) > 200 ||
		(config.Year != "" && !footerYearPattern.MatchString(config.Year)) || (!config.AutoYear && config.Year == "") || config.Links == nil || len(config.Links) > 40 {
		return invalid
	}
	ids := make(map[string]bool)
	for _, link := range config.Links {
		if link.ID == "" || len(link.ID) > 80 || ids[link.ID] || strings.TrimSpace(link.Label) == "" ||
			utf8.RuneCountInString(link.Label) > 80 || utf8.RuneCountInString(link.Group) > 40 ||
			!slices.Contains([]string{"custom", "models", "pricing", "docs", "about", "agreement", "privacy", "open-source"}, link.Source) ||
			!SafeFooterURL(link.URL, link.External) {
			return invalid
		}
		ids[link.ID] = true
	}
	return nil
}
