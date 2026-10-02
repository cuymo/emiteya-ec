import express from "express";
import { db } from "../infrastructure/db.ts";

export const adapter = { express, db };
