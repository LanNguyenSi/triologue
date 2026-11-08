#!/usr/bin/env python3
"""Structural checks for one nginx config, run on directives, not on lines.

Used by scripts/nginx-configs.test.sh (usage: nginx-config-lint.py <file>
<label> <min-upload-mb>). The tokenizer follows the parts of nginx syntax
these configs use: `#` starts a comment at the start of a token, single and
double quotes make `;`, `{`, `}` and whitespace text, `${name}` is one word
(any other `${` is refused, nginx would end the word earlier), a backslash
keeps the next character literal. Directives end at `;`, blocks open at `{`
and close at `}`, so two directives on one line, a directive spread over
several lines, a commented-out directive and a respaced header look the same
here as they do to nginx. It is not a full nginx parser: what it cannot model
(nested location, if or include inside the two /api/ blocks) is refused, not
guessed, and anything it cannot parse fails. Every check below is expressed
on that tree.

Prints one "PASS: ..." or "FAIL: ..." line per check; exit 1 if any FAIL.
"""
import re
import sys

# The variables the files log_format may use, and must all use: nginx's
# default "main" format minus the query-carrying part of $request, which the
# three request-line variables replace. Anything else ($request_uri, $args,
# $query_string, $is_args, $arg_<name>) can carry the file token; nothing of
# main may be dropped, because operators grep these lines for those fields.
ALLOWED_FORMAT_VARS = {
    "remote_addr", "remote_user", "time_local", "request_method", "uri",
    "server_protocol", "status", "body_bytes_sent", "http_referer",
    "http_user_agent", "http_x_forwarded_for",
}
UPLOAD_SOURCE = "server/src/routes/upload.ts"
SEP = " \t\r\n"


class ParseError(Exception):
    pass


class Node:
    """A directive (name, args); a block if it has children (is_block)."""

    def __init__(self, name, args, line):
        self.name = name
        self.args = args
        self.line = line
        self.is_block = False
        self.children = []
        self.comments = []

    def walk(self):
        for c in self.children:
            yield c
            yield from c.walk()

    def all_comments(self):
        out = list(self.comments)
        for c in self.children:
            out.extend(c.all_comments())
        return out

    def direct(self, name):
        return [c for c in self.children if c.name == name]

    def deep(self, name):
        return [c for c in self.walk() if c.name == name]


def tokenize(text):
    """Yield (kind, value, line); kind is word, sym or comment."""
    i, n, line = 0, len(text), 1
    while i < n:
        ch = text[i]
        if ch == "\n":
            line += 1
            i += 1
        elif ch in SEP:
            i += 1
        elif ch == "#":
            j = text.find("\n", i)
            j = n if j < 0 else j
            yield ("comment", text[i + 1:j], line)
            i = j
        elif ch in ";{}":
            yield ("sym", ch, line)
            i += 1
        elif ch in "'\"":
            start, buf, i = line, [], i + 1
            while True:
                if i >= n:
                    raise ParseError("line %d: unterminated quoted string" % start)
                c = text[i]
                if c == "\\" and i + 1 < n:
                    nxt = text[i + 1]
                    esc = {"t": "\t", "r": "\r", "n": "\n", '"': '"',
                           "'": "'", "\\": "\\"}
                    buf.append(esc.get(nxt, "\\" + nxt))
                    if nxt == "\n":
                        line += 1
                    i += 2
                    continue
                if c == ch:
                    i += 1
                    break
                if c == "\n":
                    line += 1
                buf.append(c)
                i += 1
            if i < n and text[i] not in SEP + ";{})":
                raise ParseError("line %d: text directly after a closing quote" % line)
            yield ("word", "".join(buf), start)
        else:
            buf = []
            while i < n and text[i] not in SEP + ";{}":
                c = text[i]
                if c == "\\" and i + 1 < n:
                    buf.append(text[i:i + 2])
                    i += 2
                elif c == "$" and text.startswith("{", i + 1):
                    m = re.match(r"\$\{[A-Za-z0-9_]+\}", text[i:])
                    if not m:
                        raise ParseError("line %d: '${' without a closing '}' in the same word; nginx ends the word earlier than this script could follow, so the config is refused instead of guessed" % line)
                    buf.append(m.group(0))
                    i += len(m.group(0))
                else:
                    buf.append(c)
                    i += 1
            yield ("word", "".join(buf), line)


def parse(text):
    root = Node("<file>", [], 0)
    root.is_block = True
    stack, words = [root], []
    for kind, val, line in tokenize(text):
        if kind == "comment":
            stack[-1].comments.append(val)
        elif kind == "word":
            words.append((val, line))
        elif val in ";{":
            if not words:
                raise ParseError("line %d: unexpected %r" % (line, val))
            node = Node(words[0][0], [w for w, _ in words[1:]], words[0][1])
            stack[-1].children.append(node)
            words = []
            if val == "{":
                node.is_block = True
                stack.append(node)
        else:  # }
            if words:
                raise ParseError("line %d: directive %r has no terminating ;" % (line, words[0][0]))
            if len(stack) == 1:
                raise ParseError("line %d: unbalanced }" % line)
            stack.pop()
    if words:
        raise ParseError("directive %r has no terminating ;" % words[0][0])
    if len(stack) != 1:
        raise ParseError("unclosed block %r from line %d" % (stack[-1].name, stack[-1].line))
    return root


fails = 0


def ok(msg):
    print("PASS: %s" % msg)


def bad(msg):
    global fails
    fails += 1
    print("FAIL: %s" % msg)


def to_mb(value):
    m = re.fullmatch(r"([0-9]+)([kKmMgG]?)", value)
    if not m:
        return None
    num, unit = int(m.group(1)), m.group(2).lower()
    mult = {"k": 1 / 1024, "m": 1, "g": 1024, "": 1 / 1048576}[unit]
    return num, int(num * mult)


def proxy_directives(block):
    """proxy_set_header and proxy_*_timeout of a block as normalised strings,
    Upgrade and Connection (the handshake headers the files route never
    serves) left out."""
    out = set()
    for d in block.direct("proxy_set_header") + [
            c for c in block.children if re.fullmatch(r"proxy_[a-z_]+_timeout", c.name)]:
        if d.name == "proxy_set_header" and d.args and d.args[0].lower() in ("upgrade", "connection"):
            continue
        out.add(" ".join([d.name] + d.args))
    return out


def check_log_format(rel, root, files_block):
    accesses = files_block.direct("access_log")
    if not accesses:
        bad("%s: location ^~ /api/files/ sets no access_log, it keeps the default format with $request" % rel)
        return
    if len(accesses) != 1:
        extra = " ".join([accesses[1].name] + accesses[1].args)
        bad("%s: location ^~ /api/files/ has %d access_log directives but must have exactly one: nginx logs to every access_log that applies, so the extra directive '%s' (line %d) would log with it too"
            % (rel, len(accesses), extra, accesses[1].line))
        return
    acc = accesses[0]
    if len(acc.args) < 2 or acc.args[0] == "off" or acc.args[1].startswith(("buffer=", "gzip", "flush=", "if=")):
        bad("%s: location ^~ /api/files/ has 'access_log %s', which names no log_format (bare or off), so the location logs with the default main format and its query-carrying $request"
            % (rel, " ".join(acc.args)))
        return
    fmt = acc.args[1]
    defs = [d for d in root.walk() if d.name == "log_format" and d.args and d.args[0] == fmt]
    if not defs:
        bad("%s: location ^~ /api/files/ logs with format \"%s\" which no log_format in %s defines" % (rel, fmt, rel))
        return
    nested = [d for d in defs if d not in root.children]
    if nested:
        bad("%s: log_format %s is not at http level (line %d is inside a block); in a conf.d file that means inside a server block, which nginx rejects"
            % (rel, fmt, nested[0].line))
    else:
        ok("%s: log_format %s sits at file top level, outside every block (these files are included inside http {})" % (rel, fmt))
    for d in defs:
        # nginx joins the format strings without a separator.
        body = "".join(d.args[1:])
        found = re.findall(r"\$(?:\{([A-Za-z0-9_]+)\}|([A-Za-z0-9_]+))", body)
        used = {a or b for a, b in found}
        if body.count("$") != len(found):
            bad("%s: log_format %s has a $ that is neither $name nor ${name} (only those are checked against the allow-list); nginx may still expand it and it could carry the file token" % (rel, fmt))
            continue
        unexpected = sorted(used - ALLOWED_FORMAT_VARS)
        missing = sorted(ALLOWED_FORMAT_VARS - used)
        if unexpected:
            bad("%s: log_format %s uses variable(s) %s, which is outside the allow-list of main-format variables minus the query and can carry the file token"
                % (rel, fmt, " ".join("$" + v for v in unexpected)))
        elif missing:
            bad("%s: log_format %s drops variable(s) %s of nginx's main format; it must mirror main minus only the query"
                % (rel, fmt, " ".join("$" + v for v in missing)))
        else:
            ok("%s: location ^~ /api/files/ logs with format %s, exactly the main format minus the query" % (rel, fmt))


def split_pass(value):
    m = re.fullmatch(r"(?:https?://)?([^/?]*)([^?]*)(\?.*)?", value)
    return m.group(1), m.group(2), m.group(3)


def check(rel, root, min_mb):
    locs = [d for d in root.walk() if d.name == "location" and d.is_block]
    api, files = [], []
    for loc in locs:
        if loc.args == ["^~", "/api/"]:
            api.append(loc)
        elif loc.args == ["^~", "/api/files/"]:
            files.append(loc)
        elif any("/api" in a.lower() for a in loc.args):
            hdr = " ".join(loc.args)
            if loc.args == ["/api/files/"]:
                bad("%s: line %d: location /api/files/ uses the plain prefix form; a regex location (location ~ \\.html$) would take /api/files/x.html, serve it as the SPA page and log the token, so the block must be written \"location ^~ /api/files/\"" % (rel, loc.line))
            elif loc.args == ["/api/"]:
                bad("%s: line %d: location /api/ uses the plain prefix form; a regex location (location ~ \\.html$) beats a plain prefix and can take an /api/ path, so the block must be written \"location ^~ /api/\"" % (rel, loc.line))
            else:
                bad("%s: line %d: location %s is an /api/ location other than the two canonical ones (^~ /api/, ^~ /api/files/); it can take a request away from them and bypass the body limit or the query-free log" % (rel, loc.line, hdr))
    if len(api) != 1:
        bad("%s: %s location ^~ /api/ block (found %d); every config in this list proxies /api/, so exactly one must exist in the ^~ form (a missing block fails, it does not skip)"
            % (rel, "no" if not api else "more than one", len(api)))
        return
    api_block = api[0]

    # The two /api/ blocks must stay flat: nginx applies a nested location or
    # if only to the requests it matches, and does not show what an include
    # adds, so a nested access_log or client_max_body_size here would look
    # like the block's own while most requests inherit something else.
    for blk in [api_block] + files:
        for d in blk.walk():
            nested_files = d.name == "location" and d.args == ["^~", "/api/files/"]
            if d.name == "include" or (d.is_block and not nested_files):
                bad("%s: line %d: '%s' inside location %s; the /api/ blocks must be flat (no nested location, if or include) so the body limit and the files access_log apply to every request they take"
                    % (rel, d.line, " ".join([d.name] + d.args), " ".join(blk.args)))

    # A: body limit inside location ^~ /api/
    cms = api_block.direct("client_max_body_size")
    if len(cms) != 1:
        bad("%s: %s client_max_body_size directly inside location ^~ /api/ (nginx's 1 MB default answers 413 for the server's %d MB uploads)"
            % (rel, "no" if not cms else "more than one", min_mb))
    else:
        val = cms[0].args[0] if len(cms[0].args) == 1 else ""
        parsed = to_mb(val)
        if parsed is None:
            bad("%s: unparsable client_max_body_size value: %s" % (rel, " ".join(cms[0].args)))
        elif parsed[0] == 0:
            bad("%s: client_max_body_size 0 is nginx's unlimited, the limit must stay finite" % rel)
        elif parsed[1] < min_mb:
            bad("%s: client_max_body_size %s is below the %d MB upload limit" % (rel, val, min_mb))
        else:
            ok("%s: client_max_body_size %s inside location ^~ /api/ covers a %d MB upload" % (rel, val, min_mb))
    if any(UPLOAD_SOURCE in c for c in api_block.all_comments()):
        ok("%s: location ^~ /api/ names where the server-side limit lives" % rel)
    else:
        bad("%s: no comment inside location ^~ /api/ naming %s (MAX_FILE_SIZE)" % (rel, UPLOAD_SOURCE))

    # B: the files route is logged without the query string
    if len(files) != 1:
        bad("%s: %s location ^~ /api/files/ block (found %d), the ?token= query would be logged in the clear"
            % (rel, "no" if not files else "more than one", len(files)))
    else:
        fb = files[0]
        check_log_format(rel, root, fb)
        ar = fb.direct("absolute_redirect")
        if len(ar) == 1 and ar[0].args == ["off"]:
            ok("%s: location ^~ /api/files/ sets absolute_redirect off, a redirect built here stays relative and cannot carry the token in an absolute http:// URL" % rel)
        else:
            bad("%s: location ^~ /api/files/ does not set absolute_redirect off exactly once; a request nginx redirects here (for example /api/files without the trailing slash) gets an absolute Location built from the request line, token included" % rel)
        touched = [d for d in [fb] + list(fb.walk())
                   if any(re.search(r"\$(\{)?(args|is_args)\b", a) for a in d.args)]
        if touched:
            bad("%s: location ^~ /api/files/ rewrites $args (line %d), the server would lose the query token it needs" % (rel, touched[0].line))
        else:
            ok("%s: location ^~ /api/files/ leaves $args untouched, the proxied request keeps the query" % rel)

        fp, ap = fb.direct("proxy_pass"), api_block.direct("proxy_pass")
        files_pp = fp[0].args[0] if len(fp) == 1 and len(fp[0].args) == 1 else ""
        api_pp = ap[0].args[0] if len(ap) == 1 and len(ap[0].args) == 1 else ""
        fhost, fpath, fquery = split_pass(files_pp)
        ahost = split_pass(api_pp)[0]
        if fquery is not None:
            bad("%s: proxy_pass in location ^~ /api/files/ sets the query string itself" % rel)
        else:
            ok("%s: proxy_pass in location ^~ /api/files/ carries no query rewrite" % rel)
        if ahost and fhost == ahost:
            ok("%s: location ^~ /api/files/ proxies to the same upstream as location ^~ /api/ (%s)" % (rel, fhost))
        else:
            bad("%s: location ^~ /api/files/ proxies to \"%s\", not the location ^~ /api/ upstream \"%s\"" % (rel, fhost, ahost))
        if fpath in ("", "/api/files/"):
            ok("%s: location ^~ /api/files/ proxy_pass path preserves /api/files/ (%s)" % (rel, files_pp))
        else:
            bad("%s: location ^~ /api/files/ proxy_pass rewrites the path to \"%s\"" % (rel, fpath))

        # C: the files block cannot drift from the /api/ block
        missing = sorted(proxy_directives(api_block) - proxy_directives(fb))
        for m in missing:
            bad("%s: location ^~ /api/files/ is missing \"%s\", which location ^~ /api/ sets" % (rel, m))
        if not missing:
            ok("%s: location ^~ /api/files/ repeats every proxy_set_header and proxy_*_timeout of location ^~ /api/ (Upgrade and Connection excepted)" % rel)

    offs = [d for d in root.deep("access_log") if d.args and d.args[0] == "off"]
    if offs:
        bad("%s: switches the access log off (line %d)" % (rel, offs[0].line))
    else:
        ok("%s: access log stays on" % rel)


def main():
    if len(sys.argv) != 4:
        print("usage: nginx-config-lint.py <file> <label> <min-upload-mb>", file=sys.stderr)
        return 2
    path, rel, min_mb = sys.argv[1], sys.argv[2], int(sys.argv[3])
    try:
        with open(path, encoding="latin-1") as fh:
            root = parse(fh.read())
    except ParseError as e:
        bad("%s: cannot parse as nginx syntax: %s" % (rel, e))
        return 1
    check(rel, root, min_mb)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
