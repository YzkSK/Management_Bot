"use client";

import Tabs from "./Tabs";
import TabsContent from "./TabsContent";
import TabsLabel from "./TabsLabel";
import TabsList from "./TabsList";
import TabsTrigger from "./TabsTrigger";
import { tabs, tabsContent, tabsLabel, tabsList, tabsTrigger } from "./variants";

const TabsVariants = {
  tabs,
  tabsContent,
  tabsLabel,
  tabsList,
  tabsTrigger,
};

const TabsParts = {
  Root: Tabs,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
  Label: TabsLabel,
};

export { Tabs, TabsContent, TabsLabel, TabsList, TabsTrigger, TabsVariants };

export default TabsParts;
