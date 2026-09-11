"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrgMember } from "@contracts/contracts";
import { useDashboard } from "@/components/dashboard/dashboard-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api";

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function formatJoinedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function MembersPage(): React.ReactElement {
  const { session, request } = useDashboard();
  const orgId = session.orgId;

  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setMembers(await request<OrgMember[]>(`/v1/orgs/${orgId}/members`));
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Could not load members.",
      );
    }
  }, [orgId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Members</CardTitle>
          <CardAction>
            {members ? (
              <span className="text-sm text-muted-foreground">
                {members.length} {members.length === 1 ? "member" : "members"}
              </span>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {error && !members ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => void load()}
              >
                Try again
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="pr-4 text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!members
                  ? [0, 1, 2].map((row) => (
                      <TableRow key={row} className="hover:bg-transparent">
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-3">
                            <Skeleton className="size-8 rounded-full" />
                            <div className="flex flex-col gap-1.5">
                              <Skeleton className="h-3.5 w-32" />
                              <Skeleton className="h-3 w-44" />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-14 rounded-full" />
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Skeleton className="ml-auto h-3.5 w-20" />
                        </TableCell>
                      </TableRow>
                    ))
                  : members.map((member) => {
                      const you = member.userId === session.user.id;
                      return (
                        <TableRow key={member.userId}>
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-3">
                              <Avatar size="sm">
                                <AvatarFallback>
                                  {initialsOf(member.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {member.name}
                                  {you ? (
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                      You
                                    </span>
                                  ) : null}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {member.email}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              {member.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-4 text-right text-muted-foreground">
                            {formatJoinedAt(member.joinedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
